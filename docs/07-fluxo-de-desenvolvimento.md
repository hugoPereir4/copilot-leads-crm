# Copiloto de Leads WhatsApp — 7. Fluxo de Desenvolvimento e Revisão

Decisões confirmadas em 23/10/2026.

## 1. Branches e entregas

- **`main`:** contém o estado revisado e funcionando do projeto. Cada fase deve cumprir os critérios aplicáveis à entrega, mesmo antes de a v1 estar completa.
- **Uma branch por entrega pequena:** reunir mudanças relacionadas a um objetivo que o autor consiga revisar sozinho. Uma entrega pode alterar API, dashboard, contratos e documentação na mesma branch.
- **Commits por mudança lógica:** manter propósito claro, evitando misturar alterações independentes.
- **Integração na `main`:** depois da revisão individual do autor e das verificações pertinentes à entrega.

Exemplos de nomes de branch: `feat/recepcao-direta`, `fix/lead-duplicado` e `chore/base-monorepo`. São nomes ilustrativos; o compromisso principal é uma branch por entrega pequena.

## 2. Conventional Commits

As mensagens seguem a estrutura `tipo(escopo opcional): descrição`. O escopo identifica a área afetada quando isso ajuda a entender a mudança.

Exemplos:

```text
feat(conversas): encaminhar solicitação à recepção
fix(leads): impedir dois atendimentos abertos por contato
docs(arquitetura): explicar as fronteiras entre módulos
chore(repo): configurar os pacotes do monorepo
```

Usar `feat` para funcionalidades e `fix` para correções. Tipos como `docs`, `test`, `refactor`, `chore`, `build` e `ci` podem descrever as demais mudanças. Quebras de compatibilidade devem ser sinalizadas conforme a especificação, com `!` ou o rodapé `BREAKING CHANGE`.

Referência: [Conventional Commits 1.0.0](https://www.conventionalcommits.org/pt-br/v1.0.0/).

## 3. Acompanhamento do aprendizado

Cada entrega deve conectar a implementação às decisões de arquitetura: responsabilidade do módulo, localização da regra, interfaces, direção das dependências, alternativas e custo da escolha. A forma de trabalho está detalhada na seção **Forma de trabalho para estudar arquitetura** do [documento de arquitetura](02-decisoes-de-arquitetura.md).

O autor está estudando Express na faculdade. Explicar rotas, routers, middlewares, requisições, respostas e tratamento de erros conforme forem usados, relacionando o framework à separação de responsabilidades da D2 e à escolha da D20.

Antes de usar Docker, avisar, explicar as operações e indicar a documentação oficial, conforme a preferência registrada na D10. Trabalhar em blocos pequenos para permitir acompanhamento e revisão.

## 4. Decisões conforme a entrega

A base de organização está definida: monólito modular, monorepo com npm workspaces, TypeScript estrito, Express, Zod e PostgreSQL local com Docker Compose. As demais escolhas serão discutidas antes da entrega que precisar delas, com explicação das alternativas e dos custos. Não é necessário concluir todas para preparar a estrutura inicial.

| Entrega | Decisão a resolver antes dela |
|---|---|
| Preparação da base | Versões compatíveis, scripts e ferramentas mínimas de qualidade |
| Persistência | `pg` e `node-pg-migrate` confirmados na D22; detalhar cada migração antes de implementar |
| Menu e perfil da clínica | Armazenamento da configuração, serviços, valores, horários e textos fictícios |
| Integração de IA | Provedor, modelo, orçamento, limites e critérios de revisão |
| Login do painel | Sessão e autenticação |
| Atualizações do painel | SSE ou polling |

**Primeira entrega da etapa 3 implementada e revisada:** estrutura dos workspaces `apps/api`, `apps/web` e `packages/shared`, configuração TypeScript estrita e scripts básicos para verificar os pacotes. Os critérios de revisão são a responsabilidade de cada pacote, a direção das dependências e o funcionamento das verificações configuradas. A entrega está na branch `chore/base-monorepo`, conforme a seção 1; instalações, configurações e roteiro de revisão estão no [documento 8](08-etapa-3-base-do-monorepo.md).

**Revisão da etapa 3 concluída pelo autor em 29/10/2026.** A integração na `main` continua pendente e separada da próxima entrega.

**Etapa 4.1 concluída em 30/10/2026:** configuração do PostgreSQL local na branch `chore/postgres-local`, criada sobre a base revisada da etapa 3. O [documento 9](09-etapa-4-postgres-local.md) explica os arquivos e os comandos. O autor confirmou o container `healthy`, publicado em `127.0.0.1:15432`, e a consulta SQL dentro do container retornou o banco e o usuário esperados. Também confirmou a persistência do marcador após recriar o container e a remoção da tabela de verificação. A próxima entrega deve definir o acesso ao banco e as migrações, implementar e validar a conexão usada pela aplicação. A etapa 4 de recebimento e persistência de mensagens continua em desenvolvimento.

**Etapa 4.2 revisada pelo autor em 04/11/2026:** branch `chore/api-database`, criada sobre a entrega 4.1 enviada ao remoto. A D22 registra a escolha de `pg` e `node-pg-migrate`. A conexão pelo Node fora do container e a inicialização do controle de migrações foram verificadas; não havia migrações de negócio nessa entrega. O [documento 10](10-etapa-4-acesso-ao-banco.md) apresenta instalações, arquivos, comandos e evidências. A integração na `main` segue separada.

**Etapa 4.3 revisada e verificada:** branch `feat/contacts-migration`, criada sobre a etapa 4.2 revisada. A primeira migração de negócio cria `contacts`. Após a autorização do autor para revisar, testar, commitar e enviar a entrega, passaram a tipagem, a compilação, seis testes de configuração e oito cenários de integração em banco descartável. A limpeza do banco de teste foi confirmada. Uma consulta de leitura encontrou a tabela com as definições esperadas e o registro da migração em `copilot_leads`; não foi necessário executar `db:migrate` nesta revisão. O [documento 11](11-etapa-4-migracao-de-contatos.md) registra a implementação e as evidências. A integração na `main` permanece separada.

**Etapa 4.4 preparada para revisão:** branch `feat/conversations-migration`, criada sobre a etapa 4.3 enviada ao remoto. A migração de `conversations` referencia `contacts`, limita os estados, mantém coerência do encerramento e propõe um índice único parcial para uma conversa aberta por contato. O campo de atribuição a atendente fica para a entrega de `users`. Foram preparados nove cenários de integração, sem executá-los nem aplicar SQL nesta preparação. Tipagem, compilação e seis testes de configuração passaram. O [documento 12](12-etapa-4-migracao-de-conversas.md) apresenta a ordem de revisão e a validação posterior.

**Validação em 05/11/2026:** a execução enviada pelo autor encontrou uma expectativa incorreta de SQLSTATE no teste de `ON DELETE RESTRICT`. Após corrigir a expectativa para `23001`, passaram `npm run check` e os 19 registros de integração (oito cenários de contatos, nove de conversas e dois agrupadores). O SQL permaneceu o mesmo; aplicação e reversão ocorreram somente em bancos descartáveis. `db:migrate` no banco do projeto não foi executado nesta correção.

**Etapa 4.4 revisada e enviada ao remoto:** commit `f0cff29`, na branch `feat/conversations-migration`. O autor autorizou a próxima entrega. A integração na `main` continua separada; não foi presumida nem executada.

**Etapa 4.5 preparada para revisão em 05/11/2026:** branch `feat/messages-migration`, criada sobre a etapa 4.4 enviada ao remoto. A migração de `messages` depende de contatos e conversas, registra o tipo de conteúdo e protege a unicidade por provedor e ID externo. Foram executados `npm run check` e `npm run test:integration`, com seis testes de configuração e 30 registros de integração aprovados, zero falhas. A aplicação e a reversão do SQL novo ocorreram apenas em banco descartável. Não foram instaladas dependências, alteradas credenciais, executado `db:migrate` no banco do projeto ou criados commits nesta entrega. O [documento 13](13-etapa-4-migracao-de-mensagens.md) apresenta a ordem de revisão. `jobs` é a próxima dependência a preparar, em entrega separada.

**Etapa 4.5 revisada e enviada ao remoto:** commit `f4c7795`, na branch `feat/messages-migration`, com a migração, testes e documentação. O autor autorizou iniciar a entrega seguinte. Não houve merge na `main`.

**Etapa 4.6 preparada para revisão em 05/11/2026:** branch `feat/jobs-migration`, sobre a etapa 4.5 enviada ao remoto. A migração de `jobs` depende de mensagens e acrescenta controle de tentativas, coerência do registro de reivindicação e unicidade por tipo e mensagem. Os onze cenários novos passaram na primeira execução, mas a execução conjunta revelou uma falha no encerramento da conexão do migrador no teste de contatos. As quatro suítes passaram a fornecer seu próprio cliente e aguardar seu encerramento antes de remover o banco descartável. Depois da correção, passaram `npm run check` e os 42 registros de integração, sem falhas. Nenhuma dependência ou credencial foi alterada. O SQL novo foi aplicado e revertido apenas em banco descartável; `db:migrate` no banco do projeto e o commit desta nova entrega continuam para depois da revisão. O [documento 14](14-etapa-4-migracao-de-jobs.md) apresenta a ordem de revisão.

**Etapa 4.6 revisada e enviada ao remoto:** dois commits na branch `feat/jobs-migration`: `c8f1be3`, correção do encerramento de conexões em três suítes existentes; `b4a5f8f`, migração de jobs, nova suíte e documentação. A conferência não encontrou segredos nos arquivos incluídos; `.env` permaneceu ignorado. Não houve merge nem aplicação de migrações no banco do projeto nessa publicação.

**Etapa 4.7 preparada para revisão em 05/11/2026:** branch `feat/message-reception-contract`, criada sobre a entrega de jobs enviada ao remoto. Primeiro bloco do módulo de mensageria: contrato validado de mensagem normalizada, porta de persistência, caso de uso e entrada interna validada. O escopo foi mantido pequeno para revisar as camadas antes da implementação PostgreSQL. `npm run check` passou em tipos, compilação e 16 testes sem banco. Não foram repetidos os testes de integração inalterados, instaladas dependências, criados commits dessa nova parte ou executadas migrações. O [documento 15](15-etapa-4-contrato-de-recepcao.md) apresenta o fluxo para revisão e a próxima implementação.

**Etapa 4.7 revisada pelo autor em 09/11/2026:** o autor confirmou revisão e testes, com a implementação já registrada nos commits `d99d743` e `7866eb7`. Os ajustes pendentes do script de testes e da documentação complementam a entrega, preservando esses commits. `npm run check` foi executado novamente e passou em tipos, compilação e 16 testes sem banco. Não houve alteração de SQL, execução de migração ou merge na `main` nesta verificação.

**Etapa 4.7 enviada ao remoto:** `374bceb` inclui os testes de recepção no script da API e `2493dcb` registra a documentação e a revisão concluída. Os dois commits anteriores do autor foram preservados; a branch `feat/message-reception-contract` ficou sincronizada com o remoto, sem merge.

**Etapa 4.8 preparada para revisão em 09/11/2026:** branch `feat/postgres-message-reception`, sobre a etapa 4.7 enviada ao remoto. A implementação PostgreSQL da porta de recepção grava contato, conversa, mensagem e eventual job na mesma transação e reconhece duplicatas. O payload bruto passa a ser validado para JSON antes da conexão. `npm run check` passou com tipos, compilação e 20 testes sem banco. A primeira tentativa de integração encontrou o PostgreSQL desligado; após iniciar Docker Desktop e o serviço do Compose, passaram os 55 registros de integração, incluindo doze cenários novos e seu agrupador. Não foram instaladas dependências, alteradas migrações ou credenciais, aplicadas migrações ao banco do projeto ou criados commits desta nova parte. O [documento 16](16-etapa-4-recepcao-postgresql.md) apresenta a ordem de revisão e as garantias verificadas.

**Etapa 4.8 revisada e enviada ao remoto pelo autor:** commit principal `8f49d0d`, preservado, e commit documental `d75bf3e`. A branch `feat/postgres-message-reception` foi conferida sincronizada com o remoto antes da próxima entrega. Não houve merge.

**Etapa 4.9 preparada para revisão em 10/11/2026:** branch `feat/simulator-webhook`, criada sobre a etapa 4.8 enviada. Foram implementados adapter do simulador, router Express, middlewares de correlação e erro, composição do servidor e comando para enviar JSON sintético. Express `5.3.0` e `@types/express` `5.0.6` foram instalados na API. Passaram tipos, compilação, 43 registros de teste sem banco e 56 de integração. A integração incluiu o caminho HTTP até o PostgreSQL descartável e emitiu um aviso isolado de conexão ociosa encerrada na suíte antiga de contatos, sem falha de cenário ou limpeza. O banco do projeto não recebeu migrações ou mensagens de teste. O [documento 17](17-etapa-4-webhook-simulador.md) apresenta o fluxo de revisão, execução manual e auditoria. A entrega permanece local para revisão, sem commit ou push.

**Etapa 4.9 revisada e validada em 11/11/2026:** o autor concluiu a revisão funcional e executou os dez cenários no Postman, com três variações de payload inválido e uma requisição normal após o erro 413. Todos passaram; o Codex confirmou a persistência com `SELECT`. Os testes automatizados foram reexecutados antes dos commits: 43 registros sem banco e 56 de integração, sem falhas. Os testes de integração usam bancos descartáveis; os testes manuais do autor persistiram somente dados sintéticos no banco do projeto. Nenhuma migração foi executada nesse banco. A organização dos commits separa adapter e exemplo, composição HTTP com ferramentas e testes, e documentação, preservando as dependências entre os arquivos. Não houve push ou merge desta entrega.

**Etapa 4.9 enviada ao remoto após autorização:** commits `8a2d3db`, `34fe2ff` e `90e1edb`, na branch `feat/simulator-webhook`, com acompanhamento de `origin/feat/simulator-webhook` e sincronização conferida. Não houve merge.

**Etapa 4.10 preparada para revisão em 11/11/2026:** branch `feat/job-claim`, criada sobre a etapa 4.9 enviada. O módulo de jobs recebeu a porta de fila, o caso de uso de reivindicação e a implementação PostgreSQL com seleção e atualização na mesma instrução. A consulta usa `FOR UPDATE SKIP LOCKED`, respeita elegibilidade e reserva um job por chamada. Passaram tipos, compilação, 46 registros sem banco e 66 de integração, incluindo nove cenários novos e seu agrupador. As contagens e os hashes dos registros do banco do projeto permaneceram iguais; os bancos descartáveis foram removidos. Nenhuma dependência, credencial ou migração foi alterada. O consumo automático continua desativado. O [documento 18](18-etapa-4-reivindicacao-de-jobs.md) apresenta a ordem de revisão; não foram feitos commits, push ou merge desta nova entrega.

**Etapa 4.10 revisada e enviada ao remoto após autorização:** commits `681b800`, `412e343` e `dce98c2`, na branch `feat/job-claim`, com acompanhamento de `origin/feat/job-claim` e sincronização conferida. O autor concluiu revisão e testes; os testes não foram repetidos durante os commits. Nenhum arquivo foi modificado nessa operação e não houve merge ou rebase.

**Etapa 4.11 preparada para revisão em 11/11/2026:** branch `feat/job-lifecycle`, criada sobre a etapa 4.10 enviada. A porta de finalização é separada da reserva; os casos de uso tratam conclusão e falhas com política de espera crescente, e a infraestrutura exige a tentativa atual para atualizar o job. Passaram tipos, compilação, 56 registros sem banco e 82 de integração, incluindo quinze cenários novos e seu agrupador. Contagens e hashes dos dados e migrações do banco do projeto permaneceram iguais; os bancos descartáveis foram removidos. Nenhum pacote, migração ou credencial foi alterado. Recuperação por tempo expirado, loop automático e processamento das conversas continuam para os próximos blocos. O [documento 19](19-etapa-4-finalizacao-de-jobs.md) apresenta o fluxo de revisão. As alterações desta etapa ficam locais, sem commit, push ou merge.

**Etapa 4.11 revisada e enviada ao remoto:** a melhoria defensiva do intervalo acrescentou dois cenários de integração, totalizando 56 registros sem banco e 84 de integração aprovados. Após autorização, foram criados e enviados os commits `68ebe4e`, `8c33553` e `dff11b2` na branch `feat/job-lifecycle`, com upstream e sincronização conferidos. Os testes não foram repetidos durante os commits; nenhum arquivo foi modificado nessa operação e não houve merge, rebase ou PR.

**Etapa 4.12 preparada para revisão em 13/11/2026:** branch `feat/job-recovery`, criada sobre a etapa 4.11 enviada. Nova porta e caso de uso recuperam reservas expiradas com prazo inicial de 120 segundos e lote de 100; a infraestrutura aplica a seleção e a atualização atomicamente, preserva o contador e respeita o limite persistido. Passaram tipos, compilação, 59 registros sem banco e 99 de integração. As contagens e hashes das cinco tabelas auditadas do banco do projeto permaneceram iguais, e não restaram bancos descartáveis. Não houve instalação de dependências, nova migração, alteração de credenciais ou consumo dos jobs do projeto. Recuperação periódica, loop e processamento real continuam pendentes. O [documento 20](20-etapa-4-recuperacao-de-jobs.md) apresenta o fluxo de revisão. As alterações ficam locais para revisão, sem commit, push ou merge.
