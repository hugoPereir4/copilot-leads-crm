# Encerramento de leads — fluxo para revisão

Branch `feat/lead-closure`, baseada em `feat/human-handoff` (`5af58f7`). Sem nova dependência, migração ou mudança no banco de demonstração. Não há login/atribuição de funcionário nem merge na main.

> **Atualização ([login de atendentes](34-login-de-atendentes.md)):** as rotas `/api/demo/*`, `/admin` e `/simulator` agora exigem sessão de atendente; sem cookie válido, a API responde `401 unauthenticated`. O atendente autenticado ainda não é registrado no lead: encerrar continua sem autoria.

## Comportamento e transação

Somente `lead.em_atendimento` + `conversa.em_atendimento_humano` podem mudar para `ganho`/`perdido` + `encerrada`, preenchendo `closed_at`. Mensagens, contato, IDs, resumo e marca Revisar permanecem preservados. Não cria nova conversa ao encerrar.

Mesmo resultado repetido sobre o par encerrado: `ja_encerrado`, sem escritas nem alteração de timestamps. Resultado diferente, estados divergentes ou lead encerrado parcialmente: conflito. Não há reabertura/edição do resultado nesta entrega.

O adapter valida a entrada antes de conectar e, em `READ COMMITTED`, bloqueia **conversa → lead → planos → blocos**. Revalida vínculos/estados após esperar pelo bloqueio; cancela apenas blocos pendentes e termina os planos cancelados. Atualiza lead e conversa antes do commit. Falha em qualquer escrita desfaz tudo. Não bloqueia jobs enquanto segura a conversa, preservando a coordenação com o worker existente (`job → conversa`). Planos antigos não produzem saídas na conversa encerrada; blocos já confirmados ficam no histórico.

A recepção existente já cria uma nova conversa quando não existe outra aberta. Isso foi verificado inclusive durante encerramento concorrente: mesmo contato, um único novo ciclo aberto, novo lead somente quando o fluxo exigir, resultado e mensagens do ciclo antigo preservados. Não foi necessário alterar o adapter de recepção.

RF09: novas ações restritas no Kanban; RF18: retorno em nova conversa; RF19: apenas abertos no quadro principal, filtro Ganho/Perdido e acesso aos históricos. Permanecem os limites da demonstração: **100 conversas mais recentes no total e 500 mensagens por conversa**, sem paginação. O filtro usa a API real já existente, não um arquivo ou mock.

## Contrato HTTP / Postman

Novo endpoint: `POST http://127.0.0.1:3000/api/demo/leads/{{leadId}}/close`.

Header `Content-Type: application/json`; Body → raw → JSON:

```json
{ "result": "ganho" }
```

Ou `{ "result": "perdido" }`. Body estrito: outros campos/valores são rejeitados. `leadId` é `lead.id`, não o identificador da conversa; obtenha-o em `GET /api/demo/conversations`.

Sucesso:

```json
{
  "status": "encerrado",
  "leadId": "<UUID do lead>",
  "conversationId": "<UUID da conversa>",
  "result": "ganho",
  "conversationStatus": "encerrada",
  "closedAt": "<instante ISO do encerramento>"
}
```

| HTTP | Resultado |
|---|---|
| 200 | `encerrado` ou `ja_encerrado` na repetição do mesmo resultado |
| 400 | `invalid_payload` (UUID/body) ou `invalid_json` (sintaxe JSON) |
| 404 | `lead_not_found` |
| 409 | `invalid_lead_state` (inclui resultado oposto ao já registrado) |
| 413 / 415 | `payload_too_large` (limite 64 KB) / `unsupported_media_type` |
| 500 | `lead_closure_failed`, sem detalhes do PostgreSQL |

Erros contêm `code`, `message`, `correlationId`, igual ao header `X-Correlation-ID`. Não há autenticação; disponível na entrada `start:demo`, vinculada a `127.0.0.1`. Não afirmar que um atendente foi identificado.

Endpoints reutilizados: `POST /webhooks/simulator`, `GET /api/demo/conversations`, `GET /api/demo/conversations/:id/messages` e `POST /api/demo/leads/:id/assume` (sem body). Nenhum endpoint novo de leitura foi necessário.

## Ordem de revisão

1. Contrato: `packages/shared/src/lead-closure.ts` e sua exportação em `packages/shared/src/index.ts`.
2. Aplicação: `apps/api/src/modules/leads/application/lead-closure-store.ts` e `apps/api/src/modules/leads/application/close-lead.ts` — validação Zod e operação atômica na porta.
3. Persistência: `apps/api/src/modules/leads/infrastructure/postgres-lead-closure-store.ts` — autorização após lock, idempotência, cancelamentos e rollback.
4. HTTP/composição: `apps/api/src/modules/leads/http/lead-closure-routes.ts` e `apps/api/src/demo.ts`.
5. Coordenação preservada, para contexto: `apps/api/src/infrastructure/simulator/postgres-simulator-effects.ts` e `apps/api/src/modules/messaging/infrastructure/postgres-incoming-message-inbox.ts`. Não foram modificados.
6. Frontend: `apps/web/src/demo.ts`, `apps/web/index.html`, `apps/web/src/styles/kanban.css` — confirmação, bloqueio das duas ações, feedback, atualização após confirmação e filtro de encerrados.
7. Testes: `apps/api/src/modules/leads/application/close-lead.test.ts`, `apps/api/src/infrastructure/simulator/simulator-flow.integration.test.ts`, `apps/web/scripts/demo-ui.test.js`. Script registrado em `apps/api/package.json`.
8. Documentação: este guia, `README.md`, `apps/web/README.md`, `docs/01-escopo-e-requisitos.md` e o parágrafo de encerramento em `docs/04-modelagem-de-dados.md`. Schema/DBML permanecem iguais.

## Testar e demonstrar

Com Docker Desktop/PostgreSQL disponíveis e as seis migrações anteriores aplicadas:

```powershell
npm run check
npm run test:integration
npm run start:demo
```

Não executar `db:migrate` para esta entrega. Caso a aplicação anterior esteja aberta, encerre-a com Ctrl+C antes de iniciar a nova versão.

1. Abra `/simulator` e `/admin` em `http://127.0.0.1:3000` (ou sua `API_PORT`).
2. Use novo telefone sintético: “Olá” → espere menu → “3”. No card Novo, clique Assumir atendimento.
3. Em Em atendimento, escolha Ganho ou Perdido e confirme. O card deve sair do quadro ativo.
4. Marque Mostrar encerrados, confira a coluna do resultado e selecione o card para ver o histórico. O seletor Contato/ciclo também identifica estado e resultado.
5. No Postman, repita o POST com o mesmo resultado: 200/`ja_encerrado`, mesmo `closedAt`. Troque o resultado: 409. Tente fechar um Novo: 409.
6. Volte ao simulador e envie mensagem pelo mesmo telefone. Uma nova conversa deve receber a abertura; siga o menu para gerar novo lead. O anterior permanece encerrado e consultável, sem duplicar o contato.

Os testes automatizados usam exclusivamente bancos descartáveis para escritas, incluindo triggers de falha e controle determinístico das corridas via locks do PostgreSQL. O teste do processo real executa também o novo endpoint. Testes web com DOM mínimo cobrem confirmação, cliques repetidos, sucesso/falha e filtro; não substituem revisão visual em navegador.

Validação final: `npm run check` aprovado com **150 testes da API + 6 testes web**, tipos e build; `npm run test:integration` aprovado com **201 registros**, sem falhas ou avisos de conexão. A suíte direcionada de fluxo passou com 32 registros. Foram corrigidas duas expectativas iniciais dos testes (texto livre aciona qualificação e a fila de locks pode incluir outro waiter); não exigiram mudar a recepção. Nenhum banco descartável permaneceu. Não foram executadas escritas, migrações ou limpeza nos dados do banco principal; os testes manuais do autor podem continuar usando-o.
