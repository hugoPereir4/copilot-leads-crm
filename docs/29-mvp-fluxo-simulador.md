# MVP — conversa completa no simulador

Branch: `feat/simulator-demo-flow`. Entrega por fluxo completo, reutilizando as etapas 4.1–4.20. Não substitui os requisitos da V1.

## O que funciona

Webhook → recepção transacional → job → decisão existente → preparação/leitura do plano → respostas simuladas → confirmação dos blocos → estado da conversa e conclusão do job → lead → painel.

- Primeira mensagem: abertura e menu. Opções 1 e 2: informações e pedido de detalhes. Opção 3: recepção, lead Novo e silêncio do bot.
- Texto que exigiria IA: lead Novo com **Revisar** e aviso de qualificação desabilitada. Não há extração fictícia, classificação como Qualificado nem chamada a provedor.
- `/simulator`: envio de texto sintético, histórico e reenvio do mesmo ID para conferir duplicação. `/admin`: colunas de leitura, histórico e botão Abrir no WhatsApp.
- O worker reserva somente mensagens do provedor `simulador`. Áudio e outras mídias continuam apenas registrados, conforme o webhook existente.

## Executar depois da revisão

**Registro da entrega de 16/11/2026, não regra vigente:** nessa entrega não foram instaladas dependências nem executadas migrações no banco principal. A sexta migração cria `leads` e uma chave composta em `conversations`. A modelagem/DBML foi atualizada com os oito campos efetivamente implementados; qualificação, atribuição e ordenação manual continuam futuras.

Com Docker Desktop aberto, na raiz:

```powershell
docker compose up -d --wait --wait-timeout 120 postgres
npm run db:check
# Após revisar a migração: este comando altera o banco configurado no .env.
npm run db:migrate
npm run start:demo
```

Abra `http://127.0.0.1:3000/simulator` e `http://127.0.0.1:3000/admin`, salvo alteração de `API_PORT`. Não execute `start:api` simultaneamente na mesma porta. O comando antigo inicia somente o webhook, sem o worker ou as telas da demonstração.

Use o telefone fictício sugerido. Envie “Olá”, espere a abertura e envie “3”. Confira o card Novo e o histórico no painel. Clique em Reenviar último envio: não deve criar outro card ou outra resposta. Para outro cenário, use um novo telefone sintético: não há comando de limpeza automática.

O worker também pode processar jobs sintéticos antigos elegíveis no banco configurado. Não há carga automática de exemplos, exclusão ou reinicialização de dados. Encerre com Ctrl+C.

## Garantias críticas

- A fila de demonstração serializa os jobs visíveis de cada conversa por `(created_at, id)`. Um anterior pendente, inclusive em retry futuro, bloqueia os posteriores sem gastar tentativas. Isso não promete ordenação de chegada de transações ainda não confirmadas. Outras conversas continuam elegíveis.
- A gravação da saída simulada, checkpoints, transição de estado e conclusão do job compartilham uma transação. Falha de criação do lead desfaz o handoff e a conclusão. A expiração de 120 segundos e a proteção por tentativa são preservadas; recuperação verificada a cada 30 segundos.
- A identidade da saída deriva do plano e da posição; retomada reutiliza o texto persistido e pula blocos confirmados. Intervenção humana cancela o restante pendente. A garantia vale para **envio simulado no PostgreSQL**; um provedor externo exigirá tratamento próprio de falhas e idempotência.
- Leads têm unicidade por conversa, vínculo composto com o contato e no máximo um aberto por contato. Atualizar não remove a marca Revisar nem regride a etapa existente.
- A composição transacional fica em `src/infrastructure/simulator`; o processador depende de portas de aplicação. O frontend importa somente os contratos públicos compartilhados, sem importar infraestrutura da API.

## Fluxo de revisão

1. [Migração de leads](../apps/api/migrations/1794873600000_create_leads.sql): vínculo, unicidades e reversão.
2. [Fila](../apps/api/src/modules/jobs/infrastructure/postgres-job-queue.ts) e [processador](../apps/api/src/modules/simulator/application/simulator-processor.ts): ordenação, reaproveitamento dos casos existentes, fallback sem IA e retry.
3. [Efeitos PostgreSQL](../apps/api/src/infrastructure/simulator/postgres-simulator-effects.ts) e [persistência do lead](../apps/api/src/modules/leads/infrastructure/postgres-reception-lead-store.ts): transações, checkpoints, proteção de tentativa e intervenção humana.
4. [Teste do fluxo](../apps/api/src/infrastructure/simulator/simulator-flow.integration.test.ts): falhas injetadas, duplicatas, retomada parcial, concorrência, migração e inicialização do processo real.
5. [Entrada](../apps/api/src/demo.ts), [rotas](../apps/api/src/http/demo-routes.ts), [consultas](../apps/api/src/infrastructure/simulator/postgres-demo-read-model.ts), [tela](../apps/web/index.html) e [frontend](../apps/web/src/demo.ts): composição, execução local e apresentação. Contratos HTTP em `packages/shared/src/demo.ts`.

## Validação e limites

`npm run check`: tipos, build e **144 testes aprovados** sem banco. `npm run test:integration`: **184 registros aprovados**, incluindo o novo fluxo, em bancos descartáveis. Nenhum banco descartável permaneceu ao final; contagens e hashes das sete tabelas preexistentes do banco principal permaneceram iguais. Para desenvolvimento direcionado, após build: `node --env-file=.env --test apps/api/dist/infrastructure/simulator/simulator-flow.integration.test.js`.

A suíte direcionada cobre 14 cenários (15 registros com o agrupador), inclusive o worker iniciado como processo real, resposta automática e recurso JavaScript servido por HTTP. Isso não substitui sua revisão visual no navegador. O banco principal não foi migrado nem utilizado pelo worker durante o desenvolvimento.

O painel ainda é somente leitura, limitado às 100 conversas mais recentes e às últimas 500 mensagens por conversa. Atualiza por consulta a cada segundo; não usa SSE. Não há login: API vinculada a `127.0.0.1`, destinada apenas à demonstração local com dados sintéticos.

## Para completar a V1

1. Escolher provedor/modelo e integrar qualificação por IA com saída estruturada validada, confiança, timeout, retry e fallback; persistir os campos úteis ao lead. A IA continuará sem escrever respostas ao cliente.
2. Implementar movimentação, assunção e encerramento do lead/conversa de forma transacional, com histórico preservado e reabertura em nova conversa; manter um card aberto por contato.
3. Login de atendentes, proteção das rotas e atualização por SSE conforme a arquitetura planejada; concluir a revisão dos critérios de aceitação da V1 e apresentação do painel.

Próxima entrega sugerida: assunção e encerramento no painel, do botão ao banco, para demonstrar o ciclo humano completo. IA real será outro fluxo completo, depois da escolha explícita da API. Integração com número real do WhatsApp continua posterior à demonstração inicial; áudio, múltiplos negócios e funcionalidades clínicas seguem fora do escopo inicial.
