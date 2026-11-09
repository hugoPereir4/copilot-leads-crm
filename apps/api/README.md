# Backend

Esta aplicação conterá o servidor Express e os módulos do monólito modular. O worker também executará no backend na v1.

A aplicação pode depender dos contratos públicos de `@copilot-leads/shared`. Os contratos não dependem desta aplicação. Os tipos do Node estão habilitados apenas neste ambiente.

`src/index.ts` continua como ponto de entrada vazio; o servidor HTTP e as regras de negócio serão construídos nas próximas entregas. A etapa 4.2 acrescentou configuração e comandos de infraestrutura executáveis separadamente.

## Banco de dados

- `src/config/database.ts`: valida as variáveis `POSTGRES_*` com Zod e retorna a configuração tipada.
- `src/infrastructure/database/pool.ts`: cria o pool `pg`, sem conexão global aberta ao importar o arquivo.
- `src/scripts/check-database.ts`: consulta banco e usuário pela conexão da aplicação e encerra o pool.
- `src/scripts/migrate-database.ts`: aplica migrações SQL com `node-pg-migrate` e mantém o histórico em `public.pgmigrations`.
- `migrations/1793750400000_create_contacts.sql`: primeira migração SQL de negócio, verificada em banco descartável e encontrada registrada no banco do projeto. `.gitkeep` permanece ignorado pelo carregador.
- `src/infrastructure/database/contacts-migration.integration.test.ts`: teste separado que cria um banco descartável para validar essa migração; oito cenários verificados.
- `migrations/1793750401000_create_conversations.sql`: migração da etapa 4.4, com referência a contatos e índice único parcial para conversa aberta; verificada em banco descartável e aguardando aplicação acompanhada no projeto.
- `src/infrastructure/database/conversations-migration.integration.test.ts`: nove cenários de conversas verificados em banco descartável em 05/11/2026.
- `migrations/1793750402000_create_messages.sql`: etapa 4.5, com referência a conversas, tipo de conteúdo e unicidade por provedor e ID externo; aguardando revisão antes da aplicação ao projeto.
- `src/infrastructure/database/messages-migration.integration.test.ts`: dez cenários de mensagens, incluindo duplicatas concorrentes e reversão que preserva contatos e conversas.
- `migrations/1793750403000_create_jobs.sql`: etapa 4.6, com referência a mensagens, unicidade por tipo e mensagem, estados, tentativas e índice de busca; aguardando revisão antes de aplicar ao projeto.
- `src/infrastructure/database/jobs-migration.integration.test.ts`: onze cenários de jobs em banco descartável.

Na raiz do monorepo, execute `npm run db:check` para testar a conexão, `npm run db:migrate` para aplicar migrações pendentes e `npm run check` para verificar tipos, compilação e testes. Os comandos de banco compilam a API e carregam o `.env` da raiz com a opção nativa `--env-file` do Node. Eles exigem o PostgreSQL em execução. O migrador cria sua tabela de histórico mesmo quando não há arquivos de migração.

Os tipos do banco e as consultas permanecerão no backend. Os contratos consumidos pelo painel continuam em `packages/shared`. Consulte o [guia da etapa 4.2](../../docs/10-etapa-4-acesso-ao-banco.md) para revisar a entrega.

Na etapa 4.3, `npm run test:integration` aplica e reverte a migração em um banco descartável, separado das tabelas do projeto. `npm run check` continua executando apenas os testes de configuração, sem aplicar SQL nem abrir conexão com o banco. O [guia da migração de contatos](../../docs/11-etapa-4-migracao-de-contatos.md) explica os arquivos e os resultados. Na revisão, não foi necessário executar `db:migrate`: a conferência de leitura encontrou a migração já registrada em `copilot_leads`.

Na etapa 4.4, `test:integration` passou a incluir os arquivos de contatos e de conversas, com bancos descartáveis independentes. Essa execução conjunta passou após a correção da expectativa de `restrict_violation` no teste de exclusão de contato com histórico. `npm run check` permanece sem acesso ao banco; `db:migrate` no banco do projeto continua para depois da revisão. O [guia da migração de conversas](../../docs/12-etapa-4-migracao-de-conversas.md) explica a dependência de contatos e o adiamento de `assigned_user_id` até existir `users`.

O campo `exports: {}` declara que esta aplicação não oferece uma interface de pacote para importação pelo dashboard. As fronteiras entre os futuros módulos também precisarão ser respeitadas no código e na revisão.

Na etapa 4.5, `test:integration` inclui também mensagens: oito cenários de contatos, nove de conversas e dez de mensagens, mais três agrupadores, totalizando 30 registros aprovados. Cada suíte usa seu próprio banco descartável; o SQL novo não foi aplicado ao banco do projeto. Nenhuma dependência foi instalada. O [guia de mensagens](../../docs/13-etapa-4-migracao-de-mensagens.md) explica as restrições e por que o tratamento de reenvios no caso de uso ainda fica para outra entrega.

Na etapa 4.6, o comando inclui onze cenários de jobs. A execução conjunta passou em 42 registros, incluindo quatro agrupadores. As quatro suítes agora fornecem um `dbClient` ao migrador e aguardam `migrationClient.end()` em `finally`, antes de remover o banco descartável. Isso corrige uma falha observada na limpeza da suíte de contatos: a versão instalada do migrador iniciava o encerramento de sua conexão sem aguardar a conclusão. O SQL das migrações anteriores e os cenários existentes não foram alterados. O [guia de jobs](../../docs/14-etapa-4-migracao-de-jobs.md) explica a correção, as restrições e o processamento ainda pendente. Nenhuma dependência foi instalada nem executado `db:migrate` no banco do projeto.

## Módulo de mensageria — etapa 4.7

O primeiro bloco está em `src/modules/messaging`:

- `contracts/normalized-message.ts`: schema Zod e tipo derivado da mensagem normalizada, separados do payload específico de um provedor.
- `application/incoming-message-inbox.ts`: porta de persistência e tipos do comando e resultado. Ainda não há implementação PostgreSQL dessa porta.
- `application/receive-message.ts`: caso de uso; solicita processamento somente para texto e depende da porta, sem importar `pg`, Express ou Zod em execução.
- `input/receive-message.ts`: entrada interna que valida `unknown`, retorna apenas nomes de campos inválidos e chama o caso de uso para dados válidos. Ainda não é uma rota HTTP.

Os testes do caso de uso e da entrada usam substitutos da porta para observar comandos, resultados e erros, sem abrir banco ou servidor. `npm run check` e `npm test` agora incluem esses testes: 16 aprovados no total, junto dos seis de configuração. Os 42 registros de integração da etapa anterior não foram repetidos nesta preparação, pois não houve alteração de SQL, acesso a banco ou infraestrutura dos testes de integração.

O [guia da etapa 4.7](../../docs/15-etapa-4-contrato-de-recepcao.md) apresenta a ordem de revisão, as dependências e o que falta para receber e persistir um webhook real. Não foram instaladas dependências nem aplicadas migrações nesta etapa.
