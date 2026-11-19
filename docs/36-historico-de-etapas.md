# Histórico de etapas

Registro das entregas, movido da seção "Estado atual" do README em 19/11/2026, sem alterar o texto. Cada parágrafo descreve uma entrega **na época em que foi feita**: contagens de testes, migrações "aguardando aplicação" e limitações citadas valem para aquela entrega, não para o estado atual. O estado atual está no [README](../README.md).

As entregas estão na ordem em que apareciam no README: as mais recentes primeiro (login, qualificação, encerramento, assunção, MVP do simulador) e, depois, as etapas 3 e 4.1 a 4.20, em ordem crescente. As entregas posteriores ao login (nome de perfil, painel em cinco colunas, remoção do filtro de encerrados e acesso de demonstração) estão nos documentos 34 e 35 e no histórico do Git.

A entrega `feat/login-atendentes`, baseada em `docs/backlog-tecnico`, protege `/admin`, `/simulator` e `/api/demo/*` com login de atendentes (RF13): sessão no servidor com cookie `HttpOnly`, senha com scrypt e atendentes criados pela linha de comando. O webhook continua aberto. Exige a migração `1795046400000_create_attendants`, a ser revisada e aplicada pelo autor. O [guia de login](34-login-de-atendentes.md) traz o contrato HTTP, a ordem de revisão e o teste manual.

A entrega `feat/lead-qualification-core`, baseada em `feat/lead-closure`, integra qualificação administrativa estruturada ao worker e ao Kanban. O modo padrão é **Simulado, sem API externa**; Gemini é opcional, explicitamente configurado no backend. Respostas ao contato continuam predefinidas. A sétima migração aguarda revisão/aplicação manual. Consulte o [guia de qualificação](32-qualificacao-de-leads.md) para instalação, configuração segura, critérios, revisão e testes. Os registros seguintes descrevem entregas anteriores e suas limitações à época.

A entrega `feat/lead-closure`, baseada em `feat/human-handoff`, permite encerrar como Ganho/Perdido, consultar encerrados e retornar ao mesmo contato em uma nova conversa, preservando o histórico. Não exige nova migração. O [guia de encerramento](31-encerramento-de-leads.md) contém o fluxo de revisão, testes manuais e contrato para o Postman.

A entrega mais recente, `feat/human-handoff`, acrescenta **Assumir atendimento** ao painel da UI Sálvia & Esmeralda. O comando muda lead e conversa juntos, cancela respostas pendentes e mantém o bot silencioso. Não exige nova migração nem identifica um funcionário autenticado. O [guia de assunção](30-assuncao-de-atendimento-humano.md) reúne os arquivos para revisão e os testes manuais. Os parágrafos seguintes registram as entregas anteriores.

A entrega atual integra um **MVP local demonstrável**, na branch `feat/simulator-demo-flow`: webhook → job → decisão → plano → resposta simulada persistida → lead → painel. Há simulador visual em `/simulator` e painel de leitura em `/admin`, iniciados por `npm run start:demo`. **A IA permanece desabilitada**: pedidos que exigiriam qualificação criam um lead Novo com indicação Revisar. Isso ainda não corresponde à V1 completa.

O [guia do fluxo demonstrável](29-mvp-fluxo-simulador.md) contém a preparação, os limites e a ordem de revisão. A nova migração de `leads` precisa ser revisada e aplicada pelo autor antes de iniciar a demonstração; não foi executada no banco principal durante o desenvolvimento. O histórico abaixo descreve as entregas anteriores.

A etapa 3 preparou os pacotes, a tipagem estrita e os scripts de verificação. A etapa 4.1 preparou o PostgreSQL local com Docker Compose e validou a persistência após recriar o container. A etapa 4.2 configurou o acesso com `pg`, a validação de ambiente com Zod e o controle de migrações com `node-pg-migrate`. A conexão pelo Node fora do container foi verificada. A API agora tem a entrada HTTP local descrita na etapa 4.9; as demais funcionalidades continuam em entregas pequenas, com revisão individual.

A etapa 4.3 foi revisada e verificada: os oito cenários de integração da migração de `contacts` passaram em banco descartável, e sua limpeza foi confirmada. Uma consulta de leitura também encontrou a migração registrada e a tabela correspondente em `copilot_leads`. O [documento 11](11-etapa-4-migracao-de-contatos.md) registra os resultados e os comandos.

A etapa 4.4 foi revisada e enviada ao remoto: migração de `conversations`, com vínculo ao contato e unicidade da conversa aberta. Em 05/11/2026, a execução conjunta dos testes de integração de contatos e conversas passou após corrigir uma expectativa de erro no teste de exclusão restrita. O [documento 12](12-etapa-4-migracao-de-conversas.md) registra essa validação em bancos descartáveis.

A etapa 4.5 foi revisada e enviada ao remoto na branch `feat/messages-migration`, commit `f4c7795`: migração de `messages`, com vínculo à conversa, identificação do tipo de conteúdo e unicidade por provedor e ID externo. Tipagem, compilação, seis testes de configuração e os 30 registros de integração passaram nessa entrega. O [documento 13](13-etapa-4-migracao-de-mensagens.md) apresenta a implementação e seus limites.

A etapa 4.6 foi revisada e enviada ao remoto na branch `feat/jobs-migration`: commits `c8f1be3` (encerramento de conexões nos testes) e `b4a5f8f` (migração de `jobs`, testes e documentação). Tipagem, compilação, seis testes de configuração e 42 registros de integração passaram nessa entrega. O [documento 14](14-etapa-4-migracao-de-jobs.md) apresenta a implementação.

A etapa 4.7 foi revisada e enviada ao remoto na branch `feat/message-reception-contract`: primeiro bloco do módulo de mensageria, com contrato de mensagem normalizada, validação de entrada e caso de uso dependente de uma porta de persistência. `npm run check` passou com 16 testes sem banco nessa entrega. O [documento 15](15-etapa-4-contrato-de-recepcao.md) apresenta o fluxo e a ordem de revisão.

A etapa 4.8 foi revisada e enviada ao remoto na branch `feat/postgres-message-reception`, com os commits `8f49d0d` e `d75bf3e`: persistência transacional e documentação. Tipagem, compilação, 20 testes sem banco e 55 registros de integração passaram nessa entrega. O [documento 16](16-etapa-4-recepcao-postgresql.md) registra as garantias verificadas.

A etapa 4.9 foi revisada e validada na branch `feat/simulator-webhook`: webhook Express local, adapter do simulador e comando para enviar um exemplo sintético. Tipagem, compilação, 43 registros de testes sem banco e 56 de integração passaram. O autor também aprovou os dez cenários manuais no Postman, com persistência conferida por consultas de leitura. Worker, respostas automáticas e painel ainda não estão implementados. O [documento 17](17-etapa-4-webhook-simulador.md) apresenta a ordem de revisão, a execução manual e seus resultados.

A etapa 4.10 foi revisada e enviada ao remoto na branch `feat/job-claim`: módulo de jobs com contrato de fila, caso de uso e reserva PostgreSQL atômica. A reserva respeita tipo, estado, agendamento e tentativas, usando `FOR UPDATE SKIP LOCKED`. Passaram tipos, compilação, 46 registros sem banco e 66 de integração. Não foram instaladas dependências ou criadas migrações. O [documento 18](18-etapa-4-reivindicacao-de-jobs.md) apresenta a ordem de revisão e as garantias verificadas.

A etapa 4.11 foi revisada e enviada ao remoto na branch `feat/job-lifecycle`: conclusão, reagendamento de falhas transitórias e falha definitiva, com proteção pela tentativa atual e espera crescente. A revisão incluiu validação defensiva do intervalo antes do SQL; passaram tipos, compilação, 56 registros sem banco e 84 de integração. Não foram instaladas dependências ou criadas migrações. O [documento 19](19-etapa-4-finalizacao-de-jobs.md) apresenta o fluxo de revisão.

A etapa 4.12 foi revisada e enviada ao remoto na branch `feat/job-recovery`: recuperação atômica de reservas expiradas, preservando contador e limite de tentativas, com prazo inicial de 120 segundos e lote de 100. A validação final passou com tipos, compilação, 59 registros sem banco e 101 de integração, incluindo a fronteira exata e o lote padrão. O [documento 20](20-etapa-4-recuperacao-de-jobs.md) apresenta o fluxo de revisão e a política de conclusão tardia.

A etapa 4.13 foi enviada para revisão na branch `feat/message-processing-context`: leitura da mensagem com sua conversa original e contato, com contrato Zod e porta de aplicação separados da consulta PostgreSQL. Passaram tipos, compilação, 62 registros sem banco e 111 de integração. A revisão técnica continua em paralelo; o consumo automático continua pendente. O [documento 21](21-etapa-4-contexto-da-mensagem.md) apresenta o fluxo de revisão.

A etapa 4.14 foi enviada para revisão na branch `feat/business-profile`: perfil fictício em JSON versionado, contrato Zod, porta de leitura e implementação de arquivo. O perfil inclui serviços, valores, horários, menu e textos-base. `npm run check` passou em tipos, compilação e 78 registros sem banco. Não houve acesso ao PostgreSQL ou instalação de dependências. O [documento 22](22-etapa-4-perfil-do-negocio.md) apresenta a ordem de revisão e os limites desta entrega.

A etapa 4.15 foi enviada para revisão na branch `feat/message-processing-decision`: decisão pura por estado, com abertura explícita, menu configurável, intenção de encaminhamento/qualificação e silêncio ou adiamento conforme o contexto. Passaram tipos, compilação e 93 registros sem banco. A decisão ainda não executa efeitos ou chama IA. O [documento 23](23-etapa-4-decisao-de-processamento.md) apresenta o fluxo de revisão.

A etapa 4.16 foi enviada para revisão na branch `feat/message-composition`: composição dos textos predefinidos com o perfil e verificação de expediente no fuso configurado, para um instante explícito. Passaram tipos, compilação e 115 registros sem banco. Não há envio de respostas ou execução do worker. O [documento 24](24-etapa-4-composicao-de-mensagens.md) apresenta as regras e o fluxo de revisão.

A etapa 4.17 foi enviada para revisão na branch `feat/response-plan-contract`: primeiro recorte do controle persistido, com modelagem do plano/blocos, schema do rascunho, porta de gravação atômica e caso de uso de preparação. Passaram tipos, compilação e 131 registros sem banco. O [documento 25](25-etapa-4-contrato-do-plano-de-resposta.md) apresenta a proposta e a ordem de revisão.

A etapa 4.18 foi enviada para revisão na branch `feat/response-plans-migration`, commits `31f4363` e `65062c5`: migração das duas tabelas com vínculos compostos, restrições e índices de unicidade. Passaram tipos, compilação, 131 registros sem banco e 131 de integração em bancos descartáveis. Depois, o autor aplicou a migração localmente; a conferência da etapa seguinte encontrou cinco migrações e as novas tabelas no banco do projeto. O [documento 26](26-etapa-4-migracao-dos-planos-de-resposta.md) apresenta o fluxo de revisão.

A etapa 4.19 foi enviada para revisão na branch `feat/postgres-response-plan`, commits `36164cb` e `981b395`: adapter PostgreSQL da porta `MessageResponsePlanStore`, com tentativa protegida, releitura de contexto, preservação do plano original e gravação atômica dos blocos. Passaram tipos, compilação, 131 registros sem banco e 155 de integração. O banco do projeto permaneceu intacto e não restaram bancos descartáveis. O [documento 27](27-etapa-4-preparacao-postgresql-do-plano.md) apresenta as garantias e o fluxo de revisão.

A etapa 4.20 está preparada para revisão na branch `feat/response-plan-reader`: contrato, porta, caso de uso e leitura PostgreSQL do plano original por mensagem, com blocos ordenados e confirmações. Passaram tipos, compilação, 144 registros sem banco e 169 de integração. As sete tabelas auditadas do banco do projeto permaneceram iguais e não restaram bancos descartáveis. A leitura não autoriza envio nem está ligada a um worker. O [documento 28](28-etapa-4-leitura-do-plano-de-resposta.md) apresenta a ordem de revisão e os limites.

## Histórico da API

Movido do `apps/api/README.md` em 19/11/2026, sem alterar o texto (só os links e o nível dos títulos). Os caminhos citados, como `src/...` e `migrations/...`, são relativos a `apps/api`. Registra as entregas da API até a etapa 4.20, na época em que foram feitas. O estado atual da API está no [README da API](../apps/api/README.md).

### Banco de dados

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

Os tipos do banco e as consultas permanecerão no backend. Os contratos consumidos pelo painel continuam em `packages/shared`. Consulte o [guia da etapa 4.2](10-etapa-4-acesso-ao-banco.md) para revisar a entrega.

Na etapa 4.3, `npm run test:integration` aplica e reverte a migração em um banco descartável, separado das tabelas do projeto. `npm run check` continua executando apenas os testes de configuração, sem aplicar SQL nem abrir conexão com o banco. O [guia da migração de contatos](11-etapa-4-migracao-de-contatos.md) explica os arquivos e os resultados. Na revisão, não foi necessário executar `db:migrate`: a conferência de leitura encontrou a migração já registrada em `copilot_leads`.

Na etapa 4.4, `test:integration` passou a incluir os arquivos de contatos e de conversas, com bancos descartáveis independentes. Essa execução conjunta passou após a correção da expectativa de `restrict_violation` no teste de exclusão de contato com histórico. `npm run check` permanece sem acesso ao banco; `db:migrate` no banco do projeto continua para depois da revisão. O [guia da migração de conversas](12-etapa-4-migracao-de-conversas.md) explica a dependência de contatos e o adiamento de `assigned_user_id` até existir `users`.

O campo `exports: {}` declara que esta aplicação não oferece uma interface de pacote para importação pelo dashboard. As fronteiras entre os futuros módulos também precisarão ser respeitadas no código e na revisão.

Na etapa 4.5, `test:integration` inclui também mensagens: oito cenários de contatos, nove de conversas e dez de mensagens, mais três agrupadores, totalizando 30 registros aprovados. Cada suíte usa seu próprio banco descartável; o SQL novo não foi aplicado ao banco do projeto. Nenhuma dependência foi instalada. O [guia de mensagens](13-etapa-4-migracao-de-mensagens.md) explica as restrições e por que o tratamento de reenvios no caso de uso ainda fica para outra entrega.

Na etapa 4.6, o comando inclui onze cenários de jobs. A execução conjunta passou em 42 registros, incluindo quatro agrupadores. As quatro suítes agora fornecem um `dbClient` ao migrador e aguardam `migrationClient.end()` em `finally`, antes de remover o banco descartável. Isso corrige uma falha observada na limpeza da suíte de contatos: a versão instalada do migrador iniciava o encerramento de sua conexão sem aguardar a conclusão. O SQL das migrações anteriores e os cenários existentes não foram alterados. O [guia de jobs](14-etapa-4-migracao-de-jobs.md) explica a correção, as restrições e o processamento ainda pendente. Nenhuma dependência foi instalada nem executado `db:migrate` no banco do projeto.

### Módulo de mensageria — etapa 4.7

O primeiro bloco está em `src/modules/messaging`:

- `contracts/normalized-message.ts`: schema Zod e tipo derivado da mensagem normalizada, separados do payload específico de um provedor.
- `application/incoming-message-inbox.ts`: porta de persistência e tipos do comando e resultado. A etapa 4.8 acrescenta sua implementação PostgreSQL em `infrastructure`.
- `application/receive-message.ts`: caso de uso; solicita processamento somente para texto e depende da porta, sem importar `pg`, Express ou Zod em execução.
- `input/receive-message.ts`: entrada interna que valida `unknown`, retorna apenas nomes de campos inválidos e chama o caso de uso para dados válidos. Ainda não é uma rota HTTP.

Os testes do caso de uso e da entrada usam substitutos da porta para observar comandos, resultados e erros, sem abrir banco ou servidor. `npm run check` e `npm test` agora incluem esses testes: 16 aprovados no total, junto dos seis de configuração. Os 42 registros de integração da etapa anterior não foram repetidos nesta preparação, pois não houve alteração de SQL, acesso a banco ou infraestrutura dos testes de integração.

O [guia da etapa 4.7](15-etapa-4-contrato-de-recepcao.md) apresenta a ordem de revisão, as dependências e o que falta para receber e persistir um webhook real. Não foram instaladas dependências nem aplicadas migrações nesta etapa.

### Recepção PostgreSQL — etapa 4.8

- `modules/messaging/infrastructure/serialize-message-payload.ts`: valida o original como valor JSON com Zod e o serializa antes de reservar uma conexão; erros não incluem seu conteúdo.
- `modules/messaging/infrastructure/postgres-incoming-message-inbox.ts`: implementa `IncomingMessageInbox`, recebendo o pool por construtor. Reserva um cliente e usa a mesma conexão para toda a transação, incluindo rollback e liberação.
- `modules/messaging/infrastructure/serialize-message-payload.test.ts`: quatro testes sem banco para serialização, valores incompatíveis e erro seguro.
- `modules/messaging/infrastructure/postgres-incoming-message-inbox.integration.test.ts`: doze cenários em banco descartável para gravação, reutilização, histórico, mídia, concorrência e rollback.

Na etapa 4.8, a aplicação ainda não tinha servidor HTTP ou worker. O teste de integração conecta a entrada existente ao adaptador PostgreSQL real, aplicando as quatro migrações existentes apenas no banco criado pela própria suíte. Não foi necessário alterar a porta nem as camadas de entrada e aplicação.

`npm run check` passou em tipos, compilação e 20 testes sem banco. `npm run test:integration` passou em 55 registros: os 42 anteriores e os doze cenários novos com seu agrupador. A primeira tentativa encontrou o PostgreSQL desligado; após iniciar Docker Desktop e o serviço do Compose, a execução completa e a limpeza passaram. Nenhuma dependência, variável de ambiente ou migração foi alterada. Consulte o [guia da etapa 4.8](16-etapa-4-recepcao-postgresql.md).

### Webhook local e simulador — etapa 4.9

`POST /webhooks/simulator` recebe JSON do simulador, traduz para a mensagem normalizada e aguarda a confirmação da persistência antes de responder `200`. Mensagens próprias são ignoradas e não chegam ao caso de uso. Os erros usam `code`, `message`, `correlationId` e, na validação, `details.fields`, sem conteúdo original ou detalhes do PostgreSQL.

A composição principal está em `src/http/app.ts`. O router do módulo fica em `modules/messaging/http/simulator-webhook-router.ts`, o adapter em `modules/messaging/adapters/simulator-message.ts` e o tratamento comum de erros em `http/http-errors.ts`. `http/listen-http.ts` abre o servidor em `127.0.0.1`; `config/http.ts` valida `API_PORT`, opcional, padrão 3000. A variável foi acrescentada somente ao `.env.example`.

Na raiz, use `npm run start:api` e, em outro terminal, `npm run simulate:message`. O comando do simulador lê `examples/simulator/text-message.json` nesta aplicação, mantendo seu ID fixo para demonstrar reenvio. Antes da execução manual, as quatro migrações anteriores precisam estar aplicadas no banco configurado pelo autor. A API verifica a conexão ao iniciar, mas não aplica migrações automaticamente.

Foram instalados Express `5.3.0` e os tipos `@types/express` `5.0.6`, com versões exatas e lockfile atualizado. `npm run check` passou em tipos, compilação e 43 registros sem banco, incluindo testes HTTP em porta aleatória e o cliente executável do simulador. A integração passou em 56 registros, incluindo o webhook conectado ao PostgreSQL descartável. Não foram criadas migrações nem gravados exemplos no banco do projeto durante os testes automatizados.

Em 11/11/2026, o autor executou e aprovou os dez cenários manuais no Postman, incluindo três variações de payload inválido e uma verificação adicional após o erro 413. Esses envios persistiram dados sintéticos no banco do projeto; o Codex conferiu os resultados com `SELECT`, sem modificar diretamente os dados ou executar migrações nesse banco. Consulte o [guia da etapa 4.9](17-etapa-4-webhook-simulador.md) para os resultados, a revisão e os avisos de auditoria das dependências de desenvolvimento.

### Reivindicação de jobs — etapa 4.10

`modules/jobs/application/job-queue.ts` define a porta de reserva e o resultado interno. O caso de uso `claim-next-job.ts` solicita apenas `processar_mensagem`; não conhece PostgreSQL ou HTTP. `modules/jobs/infrastructure/postgres-job-queue.ts` implementa a reserva com uma única instrução SQL, usando `FOR UPDATE SKIP LOCKED` e `UPDATE ... RETURNING` na mesma transação implícita.

A consulta considera somente jobs pendentes, com agendamento atingido e tentativas disponíveis, e reserva no máximo um por chamada. A reserva muda o estado para `processando`, incrementa `attempts` e preenche `locked_at`. Jobs indisponíveis retornam ausência de trabalho; falhas continuam sendo propagadas. Conclusão e novas tentativas foram acrescentadas na etapa 4.11; recuperação, na etapa 4.12. O processamento automático continua pendente.

O módulo ainda não está conectado ao ponto de entrada da API e não consome os jobs existentes. Não foram adicionadas dependências ou migrações. `npm run check` passou com 46 registros sem banco e `npm run test:integration` com 66 registros em bancos descartáveis. As contagens e os hashes dos registros do banco do projeto permaneceram iguais antes e depois. Consulte o [guia da etapa 4.10](18-etapa-4-reivindicacao-de-jobs.md) para a ordem de revisão e os comandos.

### Finalização e novas tentativas — etapa 4.11

`modules/jobs/application/job-lifecycle.ts` define uma porta separada para finalizar tentativas. `complete-job.ts` solicita conclusão; `fail-job.ts` usa `retry-policy.ts` para classificar a decisão e calcular espera exponencial de cinco segundos, limitada a sessenta. A infraestrutura confere o limite atual do banco antes de reagendar e registra somente códigos controlados de erro.

`PostgresJobQueue` implementa as duas portas. Os métodos novos exigem ID, estado `processando` e contador da tentativa atual. Se a reserva não corresponder, retornam `reserva_desatualizada` sem sobrescrever a linha. Sucesso limpa trava e erro; falha transitória com saldo volta para pendente; limite atingido ou falha definitiva encerra como `falhou`. O contador aumenta somente ao reservar.

Na revisão foi acrescentada a validação defensiva de `delaySeconds` antes do SQL: com retry, o intervalo deve ser finito, maior que zero e no máximo sessenta segundos. Passaram 56 registros sem banco e 84 de integração. Não houve instalação de pacotes, novas migrações ou alterações de credenciais. A entrega foi revisada e enviada ao remoto. O [guia da etapa 4.11](19-etapa-4-finalizacao-de-jobs.md) apresenta o fluxo de revisão e os comandos.

### Recuperação de jobs interrompidos — etapa 4.12

`modules/jobs/application/job-recovery.ts` define a terceira porta, separada de reserva e finalização. `recover-expired-jobs.ts` solicita recuperação de `processar_mensagem`, com prazo de 120 segundos e lote de 100. A infraestrutura valida as opções, seleciona reservas expiradas com `FOR UPDATE SKIP LOCKED` e atualiza o lote em uma única instrução.

Com saldo, o mesmo job volta a `pendente` e fica disponível imediatamente; sem saldo, fica `falhou`. Os dois caminhos limpam `locked_at` e registram `processing_reservation_expired`. O contador é preservado e só aumenta na próxima reserva. Finalizações antigas deixam de corresponder ao estado ou contador após a recuperação.

Na validação final passaram tipos, compilação, 59 registros sem banco e 101 de integração, incluindo o lote padrão e a fronteira exata do prazo. A entrega foi revisada e enviada ao remoto. Nenhuma dependência, migração ou credencial mudou. A operação ainda não é executada periodicamente e não está ligada ao ponto de entrada da API. O [guia da etapa 4.12](20-etapa-4-recuperacao-de-jobs.md) apresenta a ordem de revisão e a política de conclusão tardia antes da recuperação.

### Contexto da mensagem — etapa 4.13

`modules/messaging/contracts/message-processing-context.ts` define o schema Zod e deriva o tipo de leitura interno. A porta `MessageProcessingContextReader` e o caso de uso `loadMessageProcessingContext` ficam na aplicação; `PostgresMessageProcessingContextReader` faz um SELECT parametrizado com JOINs por mensagem, conversa original e contato. O resultado é validado antes de entrar na aplicação, sem carregar o JSON bruto.

A leitura preserva campos nulos, os seis estados, direção e remetente. Mensagem inexistente retorna `undefined`; falhas são propagadas e dados incompatíveis com o schema recebem erro sem valores sensíveis. `createdAt` representa a data de persistência. O contexto é uma fotografia e não autoriza resposta automática ou substitui controles de concorrência do futuro processador.

Passaram tipos, compilação, 62 registros sem banco e 111 de integração. As contagens e hashes das tabelas do projeto permaneceram iguais, e não restaram bancos descartáveis. Não houve instalação de pacotes, novas migrações ou alterações de credenciais. O leitor ainda não está ligado à composição da API ou ao consumo da fila. O [guia da etapa 4.13](21-etapa-4-contexto-da-mensagem.md) contém a ordem de revisão e os comandos.

### Perfil configurável do negócio — etapa 4.14

`config/business-profile.json` contém um perfil fictício de demonstração com nome, fuso, moeda, horários, serviços, valores em centavos, menu e textos-base. O módulo `business-profile` define o schema Zod e a porta `BusinessProfileReader`; `loadBusinessProfile` solicita a configuração sem conhecer arquivos ou banco.

`JsonBusinessProfileReader` lê o arquivo por um caminho relativo ao módulo, interpreta JSON como `unknown` e valida o schema. Cada chamada faz uma nova leitura. Arquivo indisponível, JSON malformado e perfil inválido têm códigos separados, com mensagens sem conteúdo ou caminho fornecido. Não há fallback silencioso para o perfil de demonstração.

O build TypeScript não copia o JSON: a pasta `config` deve acompanhar a estrutura da API. O perfil ainda não é carregado pela composição principal. Composição de mensagens, cálculo de expediente, decisões por estado e campos extras de qualificação por IA ficam para seus próprios blocos.

Passaram tipos, compilação e 78 registros sem banco, incluindo 16 testes novos do contrato, aplicação e arquivos reais temporários. A integração PostgreSQL não foi repetida; seus caminhos e scripts não mudaram e não houve acesso ao banco. Nenhuma dependência, migração ou credencial mudou. O [guia da etapa 4.14](22-etapa-4-perfil-do-negocio.md) contém os dados propostos, a ordem de revisão e os comandos.

### Decisão de processamento por estado — etapa 4.15

`modules/messaging/contracts/message-processing-decision.ts` define as intenções internas. `application/decide-message-processing.ts` recebe contexto, opções do perfil e indicação obrigatória de abertura pendente/enviada, retornando a ação e, quando aplicável, o estado proposto. Não realiza leituras, gravações, envios ou chamadas à IA.

A regra usa o menu configurado, diferencia texto livre de escolha numérica e preserva silêncio nos estados humanos e encerrados. Em `qualificando`, retorna adiamento para não iniciar outra extração ou propor o descarte da mensagem. O tratamento desse adiamento e a fonte persistida do controle de abertura ficam para a integração com o executor.

Passaram tipos, compilação e 93 registros sem banco, incluindo 15 testes novos. Não houve dependências novas, acesso ao PostgreSQL ou Docker; os testes PostgreSQL inalterados não foram repetidos. A função ainda não está ligada ao webhook, à composição principal ou ao worker. O [guia da etapa 4.15](23-etapa-4-decisao-de-processamento.md) contém a matriz de regras, os limites e a ordem de revisão.

### Composição de mensagens e expediente — etapa 4.16

`modules/business-profile/application/is-business-open.ts` verifica as faixas para um instante explícito no fuso do perfil, incluindo o início e excluindo o fim. `modules/messaging/application/compose-message-response.ts` transforma a decisão e o perfil em uma lista ordenada de textos. Compõe nome/saudação, menu, serviços, preços, horários e perguntas; somente a abertura fora do expediente inclui o aviso com horários.

As funções não consultam o relógio ou a infraestrutura e preservam as entradas. Dias sem faixas aparecem fechados. Preços nulos permanecem não informados; a formatação preserva centavos em todo o intervalo de inteiros seguros do contrato. Recepções, qualificações, silêncio e adiamento não produzem texto adicional.

Passaram tipos, compilação e 115 registros sem banco, com 22 testes novos. Nenhuma dependência, credencial ou migração mudou; não houve acesso ao PostgreSQL ou Docker. Os testes PostgreSQL inalterados não foram repetidos. Não há ligação com webhook/worker ou envio de mensagens. O [guia da etapa 4.16](24-etapa-4-composicao-de-mensagens.md) apresenta as regras de expediente, os limites da composição e a ordem de revisão.

### Contrato do plano de resposta — etapa 4.17

`modules/messaging/contracts/message-response-plan.ts` valida o rascunho: origem interna, estado esperado, ação textual, instante de referência e blocos não vazios com posições consecutivas. `MessageResponsePlanStore` define a futura gravação atômica e seus resultados. `prepareMessageResponsePlan` confere a reserva/mensagem, usa a data de persistência da mensagem como referência de expediente, compõe os textos e entrega o plano inteiro à porta.

O caso de uso preserva resultados de plano existente, conflitos e adiamentos; não confirma envio ou conclusão de job. A modelagem propõe `response_plans` e `response_blocks`, diferencia abertura preparada de enviada e exige preservação do primeiro snapshot salvo. Não há implementação da porta, tabela ou migração nesta entrega.

Passaram tipos, compilação e 131 registros sem banco, incluindo 16 testes novos. Os substitutos não comprovam concorrência, rollback ou idempotência PostgreSQL. Não houve acesso ao banco, Docker, dependências novas ou mudanças de credenciais. O [guia da etapa 4.17](25-etapa-4-contrato-do-plano-de-resposta.md) apresenta o modelo proposto, os limites e o fluxo de revisão.

### Migração dos planos e blocos — etapa 4.18

`1794787200000_create_response_plans.sql` cria planos e blocos, adicionando chaves únicas de apoio em `messages` e `jobs` para conferir os vínculos compostos. Protege um plano por mensagem, abertura única e um pendente por conversa, além de posições e confirmações de bloco coerentes. `response_blocks.conversation_id` permite conferir também a conversa da mensagem confirmada.

A suíte nova verifica as restrições, corridas de unicidade, rollback explícito, reaplicação e reversão, somente em banco descartável. Quatro suítes existentes passaram a incluir as duas tabelas na limpeza por `TRUNCATE`, sem `CASCADE` ou alterações de produção. Passaram tipos, compilação, 131 registros sem banco e 131 de integração. O banco principal manteve as mesmas contagens/hashes e quatro migrações; as novas tabelas não foram aplicadas nele. Não restaram bancos descartáveis.

Não há implementação da porta, confirmação de envio ou worker nesta entrega. A migração não valida a tentativa atual, FIFO entre mensagens ou quantidade/contiguidade de todos os blocos. O [guia da etapa 4.18](26-etapa-4-migracao-dos-planos-de-resposta.md) apresenta as garantias, os limites e a ordem de revisão.

### Preparação PostgreSQL dos planos — etapa 4.19

`modules/messaging/infrastructure/postgres-message-response-plan-store.ts` implementa a porta existente, validando o comando antes da conexão. A transação `READ COMMITTED` bloqueia job, conversa e mensagem nessa ordem, confere a tentativa e os vínculos, reconhece o original e só então exige as condições de uma nova preparação. Plano e todos os blocos usam o mesmo cliente; erro provoca rollback.

Abertura pendente adia outra mensagem; cancelada não autoriza recriação. Menu exige abertura enviada, e outra resposta pendente também adia a preparação. Uma nova tentativa válida do mesmo job reconhece o plano original sem sobrescrever seu conteúdo, mesmo após avanço de estado/perfil. O resultado existente não autoriza envio. Os 120 segundos continuam tornando o job recuperável, sem revogação automática da tentativa.

Passaram tipos, compilação, 131 registros sem banco e 155 de integração, com 23 cenários novos e seu agrupador. As sete tabelas auditadas do projeto mantiveram contagens/hashes e não restaram bancos descartáveis. Não há migração nova, dependência instalada, ligação do adapter à composição da API ou execução automática. O [guia da etapa 4.19](27-etapa-4-preparacao-postgresql-do-plano.md) apresenta os testes, o aviso observado na suíte existente de recuperação e a ordem de revisão.

### Leitura do plano persistido — etapa 4.20

`MessageResponsePlanSnapshot` descreve o plano original com blocos ordenados, status, datas e confirmações. Reutiliza os campos de criação, mas valida também a representação do progresso. `MessageResponsePlanReader` define a consulta por UUID da mensagem de origem; `loadMessageResponsePlan` delega sem conhecer PostgreSQL ou recompor textos.

`PostgresMessageResponsePlanReader` valida o UUID antes do SQL e lê plano/blocos numa única instrução com `LEFT JOIN` e ordenação por posição. Ausência retorna `undefined`; plano sem blocos ou incoerente rejeita com mensagem fixa; falhas SQL são propagadas. A leitura inclui enviados/cancelados e conversas encerradas, sem reservar jobs, autorizar envio ou reparar dados.

Passaram tipos, compilação, 144 registros sem banco e 169 de integração, com dez testes novos de contrato, três de aplicação e 13 cenários PostgreSQL mais seu agrupador. Contagens/hashes das sete tabelas auditadas permaneceram iguais e não restaram bancos descartáveis. Nenhuma migração ou dependência mudou; o leitor ainda não está conectado ao webhook ou worker. O [guia da etapa 4.20](28-etapa-4-leitura-do-plano-de-resposta.md) apresenta o fluxo de revisão, as regras de coerência e o aviso observado na suíte existente de reivindicação.
