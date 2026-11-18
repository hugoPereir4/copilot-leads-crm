# Assunção de atendimento humano

Branch: `feat/human-handoff`, baseada em `feat/dashboard-ui` (`8731dc4`), que contém o MVP `feat/simulator-demo-flow`. Sem merge na main, rebase, dependência nova ou nova migração.

> **Atualização ([login de atendentes](34-login-de-atendentes.md)):** as rotas `/api/demo/*`, `/admin` e `/simulator` agora exigem sessão de atendente; sem cookie válido, a API responde `401 unauthenticated`. O atendente autenticado ainda não é registrado no lead: assumir continua sem autoria.

## Entrega e regras

Mensagem → lead Novo → card → **Assumir atendimento** → lead Em atendimento + conversa Em atendimento humano → novas mensagens registradas sem respostas automáticas.

Atende RF12 no fluxo simulado e parte de RF09: movimentação pela ação de assumir. Não implementa drag-and-drop, encerramento, login ou atribuição a funcionário. Sem autenticação, “assumir” representa somente a transição para atendimento humano. A aplicação permanece local, vinculada a `127.0.0.1`; não publicar estas rotas como painel autenticado.

| Lead anterior | Conversa anterior | Resultado |
|---|---|---|
| `novo` ou `qualificado` | `aguardando_humano`, `aguardando_menu`, `aguardando_detalhes` ou `qualificando` | `em_atendimento` + `em_atendimento_humano` |
| `em_atendimento` | `em_atendimento_humano` | Sucesso idempotente, sem nova escrita |
| Encerrado ou combinação incompatível | Qualquer outro caso | Conflito, sem efeitos |

As etapas automáticas são elegíveis para permitir intervenção humana com resposta ainda pendente; no caminho normal do MVP, o lead nasce em `aguardando_humano`. IDs, contato, resumo, marca Revisar, mensagens e confirmações anteriores são preservados. Não há novo lead ou conversa.

## Transação e concorrência

1. Validar e normalizar UUID com Zod antes de obter conexão.
2. `BEGIN READ COMMITTED`; bloquear a conversa associada ao lead.
3. Reler e bloquear o lead, conferir vínculo com conversa/contato e estados atuais. Uma leitura anterior não autoriza a transição.
4. Bloquear planos pendentes; cancelar somente blocos pendentes, mantendo checkpoints enviados. Marcar planos cancelados com término.
5. Atualizar etapa e `updated_at` do lead; atualizar estado da conversa; confirmar tudo junto. Qualquer falha desfaz todas as mudanças.

O worker existente bloqueia job → conversa antes de preparar ou emitir respostas. A assunção bloqueia conversa → lead → planos/blocos e **não** tenta obter bloqueios de jobs ou mensagens. A conversa compartilhada serializa os efeitos sem introduzir ciclo de espera. Não foi necessário modificar o worker.

Se o worker confirmar antes, suas mensagens continuam no histórico. Se a assunção confirmar primeiro, o executor relê o estado humano ou encontra o plano cancelado, conclui o job sem enviar e não regride a conversa. A promessa é ausência de novas saídas após a confirmação da transição, não apagar mensagens já enviadas. O envio atual é simulado no PostgreSQL; provedores externos exigirão coordenação própria.

## HTTP e interface

`POST /api/demo/leads/:id/assume`, sem body. Disponível em `start:demo`; a entrada antiga `start:api` continua dedicada ao webhook.

| HTTP | Resultado |
|---|---|
| 200 | `status: assumido` ou `ja_assumido`, `leadId`, `conversationId`, `stage: em_atendimento`, `conversationStatus: em_atendimento_humano` |
| 400 | `invalid_payload` para UUID inválido |
| 404 | `lead_not_found` |
| 409 | `invalid_lead_state` |
| 500 | `human_handoff_failed`, sem expor SQL ou detalhes da falha |

Erros incluem `code`, `message`, `correlationId`, correspondente ao header `X-Correlation-ID`. O sucesso HTTP ocorre depois do commit. Falha de rede pode ocorrer após o commit: repetir o POST é seguro.

O botão aparece somente para Novo/Qualificado em conversa elegível. A requisição desabilita a ação, inclusive se o polling redesenhar o card. Sucesso atualiza o painel por leitura da API, sem navegação ou movimentação otimista. Erros usam uma região de alerta acessível; o botão WhatsApp permanece disponível. Respostas de polling anteriores à confirmação não devem recolocar um card antigo; o histórico também descarta uma leitura de uma seleção já trocada.

## Ordem de revisão dos arquivos

1. **Contrato público:** `packages/shared/src/human-handoff.ts`, exportado por `packages/shared/src/index.ts`. Identidade e resultado, sem usuário fictício.
2. **Porta e caso de uso:** `apps/api/src/modules/leads/application/human-handoff-store.ts` e `apps/api/src/modules/leads/application/assume-human-attendance.ts`. Validação da entrada e delegação da operação atômica, sem depender de PostgreSQL.
3. **Persistência:** `apps/api/src/modules/leads/infrastructure/postgres-human-handoff-store.ts`. Bloqueios, revalidação, transições, cancelamento parcial e rollback.
4. **HTTP e composição:** `apps/api/src/modules/leads/http/human-handoff-routes.ts` e `apps/api/src/demo.ts`. Mapeamento dos resultados e conexão das dependências no processo local.
5. **Integração existente, para contexto:** `apps/api/src/infrastructure/simulator/postgres-simulator-effects.ts`, `apps/api/src/modules/messaging/infrastructure/postgres-message-response-plan-store.ts` e `apps/api/src/modules/simulator/application/simulator-processor.ts`. Arquivos preservados; conferir que o bloqueio da conversa e a releitura do estado impedem envio após assunção.
6. **Frontend:** `apps/web/src/demo.ts`, `apps/web/index.html`, `apps/web/src/styles/kanban.css`. Ação, feedback, polling, temas e estilos preservados. A composição dos estilos continua em `apps/web/scripts/copy-styles.js`, sem mudanças.
7. **Testes:** `apps/api/src/modules/leads/application/assume-human-attendance.test.ts`, `apps/api/src/infrastructure/simulator/simulator-flow.integration.test.ts` e `apps/web/scripts/demo-ui.test.js`.
8. **Scripts:** `apps/api/package.json`, `apps/web/package.json`, `package.json`. Registro dos testes; `check` agora inclui os testes web.
9. **Documentação:** este guia, `README.md`, `apps/web/README.md` e `docs/01-escopo-e-requisitos.md`.

## Verificações automatizadas

Na raiz, com PostgreSQL disponível:

```powershell
npm run check
npm run test:integration
```

Durante o desenvolvimento, após build:

```powershell
node --test apps/api/dist/modules/leads/application/assume-human-attendance.test.js
node --env-file=.env --test apps/api/dist/infrastructure/simulator/simulator-flow.integration.test.js
npm run test --workspace=@copilot-leads/web
```

A suíte de fluxo usa exclusivamente seu PostgreSQL descartável: Novo/Qualificado, identidade/histórico, repetição sem alterar timestamps, duas assunções concorrentes, UUID/404/409, falha 500 com rollback completo, blocos parcialmente confirmados, mensagens após assunção e revalidação após esperar pelo lock. As duas ordens de corrida usam triggers e bloqueio advisory no banco descartável: o teste observa `pg_blocking_pids` antes de liberar o vencedor, sem depender de atrasos arbitrários. O processo real também testa POST de assunção, silêncio e publicação HTTP dos seis estilos.

Os testes web executam o JS compilado com DOM mínimo: preferência/salvamento/alternância de tema, storage bloqueado, clique repetido, sucesso, erro e manutenção do WhatsApp. Não verificam renderização visual, contraste, foco ou responsividade em navegador. A conferência do build compara conteúdo dos seis CSS de origem e destino.

Resultado desta entrega: `npm run check` aprovado com **147 testes da API + 4 testes web**; `npm run test:integration` aprovado com **193 registros**, sem falhas ou avisos de conexão nessa execução. Banco principal preservado por comparação de contagens e hashes das oito tabelas existentes; nenhum banco descartável permaneceu. A validação inicial da UI anterior também passou em tipos, build e seus 144 testes da API. Um erro inicial de sintaxe no harness web (remoção do marcador de módulo antes do source map) foi corrigido no próprio teste; não exigiu alterar o código de temas.

## Teste manual para revisão

1. Abra Docker Desktop e inicie o PostgreSQL, se necessário: `docker compose up -d --wait --wait-timeout 120 postgres`.
2. Com as seis migrações anteriores já aplicadas, execute `npm run start:demo`. **Esta entrega não exige `db:migrate`.**
3. Abra `http://127.0.0.1:3000/simulator` e `/admin`, salvo outra `API_PORT`. Teste alternância Light/Dark, navegação superior e permanência do tema ao trocar de página.
4. Use um novo telefone sintético. Envie “Olá”, aguarde o menu e envie “3”. Localize o card Novo.
5. Abra seu histórico e clique **Assumir atendimento**. Confira feedback, card em Em atendimento, mesmo contato/histórico e ausência do botão de assumir. WhatsApp deve permanecer disponível.
6. Envie “Olá” e “1” pelo mesmo contato no simulador. As entradas devem aparecer no histórico, sem novas respostas do bot. A conversa deve permanecer em `em_atendimento_humano`.
7. Opcional no Postman: repita o POST do mesmo lead; espere `200 / ja_assumido`. UUID inválido: 400; UUID inexistente: 404. Sem body ou header especial.

Ainda pendentes: identificação autenticada de atendente, encerramento coordenado, demais transições do Kanban, IA estruturada e SSE. Polling e limites da demonstração anterior permanecem.
