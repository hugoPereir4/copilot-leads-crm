# Etapa 4.6 — Migração de jobs

Preparada em 05/11/2026 na branch `feat/jobs-migration`, criada sobre a entrega de mensagens revisada e enviada ao remoto (`f4c7795`). Esta entrega prepara a estrutura da fila persistida no PostgreSQL e seus testes. Não instala dependências nem modifica `.env` ou credenciais.

**Resultado:** após corrigir o encerramento das conexões do migrador nos testes, passaram `npm run check` e `npm run test:integration`: tipagem e compilação dos três pacotes, seis testes de configuração e 42 registros de integração, zero falhas. O SQL novo foi aplicado e revertido somente em banco descartável. Não foi executado `db:migrate` no banco do projeto.

## 1. Ordem de revisão

| Ordem | Arquivo | Responsabilidade |
|---|---|---|
| 1 | [1793750403000_create_jobs.sql](../apps/api/migrations/1793750403000_create_jobs.sql) | Definir vínculo à mensagem, estados, tentativas, unicidade, índice e reversão |
| 2 | Função `migrate` nas suítes de [contatos](../apps/api/src/infrastructure/database/contacts-migration.integration.test.ts), [conversas](../apps/api/src/infrastructure/database/conversations-migration.integration.test.ts) e [mensagens](../apps/api/src/infrastructure/database/messages-migration.integration.test.ts) | Corrigir o ciclo de vida do cliente usado pelo migrador |
| 3 | [jobs-migration.integration.test.ts](../apps/api/src/infrastructure/database/jobs-migration.integration.test.ts) | Preparar as três dependências e verificar onze cenários em banco descartável |
| 4 | [package.json da API](../apps/api/package.json) | Incluir a quarta suíte no comando de integração |
| 5 | [modelagem](04-modelagem-de-dados.md) | Conferir campos, restrições e DBML |

A ordem das migrações é `contacts → conversations → messages → jobs`. O prefixo do arquivo novo vem depois de mensagens porque sua chave estrangeira depende dessa tabela. Os três arquivos SQL anteriores não foram modificados.

## 2. Campos e restrições

| Campo | Definição | Responsabilidade |
|---|---|---|
| `id` | UUID obrigatório, padrão `gen_random_uuid()` | Identificar a tarefa persistida |
| `type` | Texto obrigatório, não vazio após `btrim` | Nome da tarefa, como `processar_mensagem` |
| `message_id` | UUID obrigatório, FK | Mensagem que motivou a tarefa |
| `status` | Texto obrigatório, padrão `pendente` | Um de `pendente`, `processando`, `concluido`, `falhou` |
| `attempts` | Inteiro obrigatório, padrão 0 | Tentativas realizadas, entre zero e o máximo |
| `max_attempts` | Inteiro obrigatório e positivo, padrão 3 | Total de tentativas permitidas, incluindo a primeira |
| `run_at` | Data com fuso obrigatória, padrão `now()` | Instante a partir do qual pode ser executado |
| `locked_at` | Data com fuso, permitindo nulo | Registro da reivindicação, obrigatório apenas em `processando` |
| `last_error` | Texto, permitindo nulo | Última falha registrada |
| `created_at` | Data com fuso obrigatória, padrão `now()` | Criação do job |

`jobs_message_id_fkey` usa `ON DELETE RESTRICT`: uma mensagem com job não pode ser apagada enquanto esse vínculo existir. O `Down Migration` remove apenas `jobs`, sem `CASCADE`, preservando mensagens, conversas e contatos. A reversão destrói os registros da própria fila; o teste a executa apenas no banco que ele criou.

`jobs_type_message_id_key` exige um job por `(type, message_id)`, inclusive depois de concluído. Repetir a tarefa após falha significa atualizar o mesmo registro, preservando seu contador, em vez de inserir outro job. Outro tipo de tarefa pode usar a mesma mensagem. Essa unicidade é uma proteção complementar à de `(provider, external_id)` em mensagens; não garante processamento exatamente uma vez nem substitui a idempotência dos efeitos do worker.

O nome da tarefa permanece texto aberto, com validação de vazio e espaços comuns por `btrim`. O futuro despachante deverá reconhecer somente tarefas suportadas. Os quatro estados usam texto com `CHECK`, como nas migrações anteriores.

`jobs_attempts_check` mantém `0 <= attempts <= max_attempts`; `jobs_max_attempts_check` exige máximo positivo. O padrão 3 vem da modelagem existente e representa três tentativas totais, não três novas tentativas além da primeira. A política própria de repetição da chamada de IA continua separada da fila (D8).

`jobs_locked_at_status_check` mantém a data preenchida somente em `processando`. Ao reivindicar, o futuro worker deverá atualizar estado e data juntos; ao reagendar ou finalizar, deverá limpar a data no mesmo comando de mudança de estado. O teste demonstra que essas atualizações são aceitas, sem implementar um worker.

As restrições validam a linha atual: ainda permitem, por exemplo, um job pendente que já atingiu o máximo. O futuro worker precisará filtrar o contador antes de executar, decidir quando marcar falha definitiva e definir as transições permitidas. A migração não incrementa tentativas nem muda estados automaticamente.

`jobs_status_run_at_idx`, em `(status, run_at)`, apoia a busca de jobs pendentes cujo horário chegou. Não executa agendamento nem impõe ordem aos resultados.

## 3. Fila persistida e arquitetura

O job representa trabalho a fazer; a mensagem representa o conteúdo recebido ou registrado. Separar as tabelas permite responder ao futuro webhook após persistir, deixando o processamento demorado para o worker, conforme D3/D4.

Esta entrega define a estrutura. A gravação atômica de mensagem e job ainda será implementada no fluxo de recepção, com `BEGIN`, inserções e `COMMIT` no mesmo cliente reservado do pool; em erro, `ROLLBACK`. Ter duas tabelas não garante, por si só, que duas gravações independentes serão atômicas.

`locked_at` é metadado persistido, não o bloqueio de linha que impede dois workers de reivindicarem o mesmo job. Essa garantia exigirá uma transação com seleção usando `FOR UPDATE SKIP LOCKED` e atualização da reivindicação. Recuperação após interrupção, prazo do bloqueio, backoff e idempotência dos efeitos serão tratados na entrega do worker. Não há temporizador ou recuperação automática neste SQL.

As consultas ficarão na infraestrutura do backend. Os futuros casos de uso dependerão de contratos próprios e não importarão `pg` ou Express. Nenhum tipo interno da tabela foi colocado em `packages/shared`, nem foi criado um serviço vazio para acompanhar a migração.

`last_error` deverá receber descrição sanitizada pela futura implementação, sem conteúdo de mensagem, credenciais ou payload bruto. O banco apenas armazena texto; não faz essa sanitização.

## 4. Correção do encerramento nos testes

A primeira execução passou nos onze cenários novos, mas falhou ao terminar o arquivo de contatos: `terminating connection due to administrator command`, registrado como atividade assíncrona após o teste. O relatório contou 42 registros aprovados e uma falha adicional no arquivo, causada pela limpeza.

Na versão instalada `node-pg-migrate@9.0.0`, `dist/legacy/db.js` e o bundle correspondente chamam `client.end()` sem aguardar sua conclusão quando a ferramenta cria o cliente. Isso permitia remover o banco descartável enquanto a conexão ainda estava encerrando.

As quatro funções `migrate` agora criam um `Client` com a configuração do banco descartável, conectam, passam `dbClient` ao `runner` e aguardam `migrationClient.end()` em `finally`. Como o cliente foi fornecido externamente, seu ciclo de vida pertence ao teste. O `return await runner(...)` mantém o encerramento depois da conclusão do migrador, inclusive em erro. Só depois os cenários e a limpeza final prosseguem.

Não foram adicionados atrasos, ignorados erros ou alteradas dependências. Os cenários antigos e os SQLs anteriores permanecem iguais. O comando de migração da aplicação também permanece igual; a correção é específica da infraestrutura dos testes que removem seus próprios bancos.

## 5. Testes executados e aplicação posterior

Cada suíte aceita apenas host local e cria um banco próprio. Jobs usa `copilot_jobs_test_<UUID hexadecimal>`, nome gerado internamente. Aplica as três dependências primeiro e depois seleciona apenas jobs para aplicar ou reverter. A limpeza exige confirmação de criação, encerra o pool e remove exclusivamente esse banco.

Os onze cenários verificam:

1. Aplicação após mensagens e histórico das quatro migrações.
2. UUID, datas, estado pendente, zero tentativas, máximo 3 e campos opcionais nulos.
3. Rejeição de campos obrigatórios explicitamente nulos.
4. Mensagem existente e proteção contra apagar mensagem com job.
5. Quatro estados válidos, rejeição de estado inválido e tipo vazio ou com espaços.
6. Tentativas dentro do intervalo e máximo positivo.
7. Coerência da data de reivindicação e reagendamento do mesmo registro.
8. Unicidade de tipo e mensagem, inclusive após concluir, permitindo outro tipo.
9. Duas inserções concorrentes produzindo apenas um job.
10. Reexecução sem reaplicar a migração ou alterar os jobs existentes.
11. Índice de busca, reversão apenas de jobs, dependências preservadas e reaplicação.

Na raiz do projeto:

```powershell
npm run check
npm run test:integration
```

O primeiro comando passou sem conectar ao banco. O segundo passou, após a correção, em oito cenários de contatos, nove de conversas, dez de mensagens e onze de jobs, mais quatro agrupadores: 42 registros aprovados, zero falhas. A limpeza dos bancos descartáveis completou com sucesso.

A migração nova aguarda revisão antes de `npm run db:migrate` no banco do projeto. Depois de revisar a estrutura, a próxima entrega pode implementar a recepção e a persistência transacional, em um bloco próprio; as demais tabelas do planejamento serão acrescentadas quando seus fluxos precisarem delas.

Referências: [cliente e encerramento no node-postgres](https://node-postgres.com/apis/client), [API programática do migrador](https://salsita.github.io/node-pg-migrate/api) (a assinatura `dbClient` também foi conferida nos tipos da versão 9 instalada), [transações](https://node-postgres.com/features/transactions) e [bloqueios de linha no PostgreSQL](https://www.postgresql.org/docs/18/explicit-locking.html).
