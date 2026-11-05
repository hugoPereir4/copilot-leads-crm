# Etapa 4.4 — Migração de conversas

Preparada em 04/11/2026 na branch `feat/conversations-migration`, a partir da etapa 4.3 enviada ao remoto. A aplicação no banco do projeto continua separada da validação em bancos descartáveis.

**Estado em 05/11/2026:** `npm run check` passou na tipagem dos três pacotes, compilação e seis testes de configuração. Após corrigir a expectativa do código de erro na exclusão com `ON DELETE RESTRICT`, `npm run test:integration` passou nos oito cenários de contatos e nove de conversas, mais os dois testes agrupadores: 19 registros aprovados, zero falhas. A migração foi aplicada e revertida apenas em bancos descartáveis. Não foi executado `db:migrate` no banco do projeto nesta correção.

## 1. Ordem de revisão

| Ordem | Arquivo | Responsabilidade |
|---|---|---|
| 1 | [1793750401000_create_conversations.sql](../apps/api/migrations/1793750401000_create_conversations.sql) | Criar e reverter a estrutura de conversas, com suas restrições e índices |
| 2 | [conversations-migration.integration.test.ts](../apps/api/src/infrastructure/database/conversations-migration.integration.test.ts) | Preparar contatos, aplicar conversas e verificar as garantias em banco descartável |
| 3 | [package.json da API](../apps/api/package.json) | Incluir a suíte de conversas no comando explícito de integração |
| 4 | [modelagem de dados](04-modelagem-de-dados.md) | Conferir campos, dependências e a parte da D16 coberta pelo SQL |

`contacts` precisa existir antes de `conversations`, pois a chave estrangeira usa seu identificador. O prefixo numérico do novo arquivo vem depois do arquivo de contatos para manter essa ordem. A migração de contatos e o código de seu teste não foram alterados. Não foram instaladas novas dependências nem alterados `.env` ou credenciais.

## 2. Campos propostos

| Campo | Definição | Responsabilidade |
|---|---|---|
| `id` | `uuid NOT NULL DEFAULT gen_random_uuid()` | Identificar um ciclo de atendimento |
| `contact_id` | `uuid NOT NULL` | Vincular o atendimento a um contato existente |
| `status` | `text NOT NULL DEFAULT 'aguardando_menu'` | Guardar um dos seis estados previstos na D7 |
| `last_message_at` | `timestamptz`, permitindo `NULL` | Registrar a última atividade quando houver mensagem; não provoca encerramento automático |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Registrar a criação da conversa |
| `closed_at` | `timestamptz`, permitindo `NULL` | Registrar o encerramento, quando ocorrer |

**Atribuição a atendente:** `assigned_user_id` permanece no modelo planejado, mas não entra neste SQL. O campo e sua chave estrangeira serão acrescentados quando a tabela `users` for implementada, antes do caso de uso de atendimento humano. A entrega atual depende somente de contatos e das conversas em si.

## 3. Restrições e índices

`conversations_pkey` identifica cada conversa. `conversations_contact_id_fkey` exige contato existente e usa `ON DELETE RESTRICT`: um contato que possui conversas não pode ser removido enquanto esse vínculo existir. A reversão da migração remove apenas `conversations`, preservando contatos.

`conversations_status_check` limita o texto aos estados `aguardando_menu`, `aguardando_detalhes`, `qualificando`, `aguardando_humano`, `em_atendimento_humano` e `encerrada`. Foi usado texto com `CHECK`, uma das opções previstas na modelagem. A lista fica explícita na tabela, sem criar um tipo enum separado; alterações futuras dessa lista continuarão exigindo migração. O enum do DBML representa conceitualmente os valores permitidos.

`conversations_closed_at_status_check` exige `closed_at` preenchido se o estado for `encerrada` e ausente nos outros estados. Ao encerrar, o futuro caso de uso precisará atualizar estado e data juntos. Esta restrição verifica coerência da linha atual; a sequência permitida de transições continua pertencendo à futura máquina de estados.

O ponto central da D16 nesta entrega é o índice:

```sql
CREATE UNIQUE INDEX conversations_one_open_per_contact_idx
  ON public.conversations (contact_id)
  WHERE status <> 'encerrada';
```

Ele exige unicidade de `contact_id` somente entre as conversas abertas, abrangendo todos os cinco estados ativos. As encerradas ficam fora desse índice e podem se repetir para o mesmo contato. O PostgreSQL participa da garantia inclusive quando duas operações tentam abrir atendimento simultaneamente.

`conversations_contact_status_idx`, em `(contact_id, status)`, inclui o histórico e serve às consultas por contato e estado. O índice parcial protege a unicidade; o índice completo cobre também as conversas encerradas. A avaliação de planos e desempenho dependerá das consultas e dos dados das entregas futuras.

O `Down Migration` usa `DROP TABLE public.conversations`, sem `CASCADE`. Os índices da própria tabela são removidos junto dela; futuras tabelas que a referenciem precisarão ser revertidas antes. A tabela `contacts` permanece.

## 4. O que pertence ao monólito modular

Contato representa a pessoa e conversa representa um ciclo de atendimento. Essa distinção permite iniciar outro ciclo sem apagar os encerrados. O banco armazena e protege os vínculos; os futuros casos de uso decidirão quando reutilizar uma conversa aberta e quando criar outra.

Esta entrega não implementa a máquina de estados, a proibição de reabrir conversas encerradas, o vínculo com lead, a assunção por atendente ou a gravação de mensagens. Esses comportamentos continuam para seus módulos e casos de uso. A restrição de estados valida valores, sem validar a história das transições. A unicidade de lead aberto exigirá sua própria tabela e restrição.

Não foram criados controller, serviço de negócio ou repositório apenas para acompanhar a migração. O detalhe SQL permanece no backend; `packages/shared` não recebe tipos internos da tabela.

## 5. Testes de integração

A suíte nova segue o isolamento da etapa anterior: aceita apenas PostgreSQL local e cria um banco com prefixo `copilot_conversations_test_` e sufixo UUID gerado no próprio teste. O teste não recebe o nome desse banco pelo ambiente. Só executa sua remoção se a criação tiver tido sucesso, fechando antes o pool.

No banco descartável, a suíte aplica contatos primeiro. Depois aplica ou reverte apenas a migração de conversas, selecionada pelo nome. O helper `createContact` é uma fixture que insere dados sintéticos para cada cenário; não representa um repositório da aplicação.

Os nove cenários propostos verificam:

1. Aplicação após contatos e histórico com os dois arquivos na ordem correta.
2. UUID, data e estado inicial padrão, com datas de atividade e encerramento ausentes.
3. Contato obrigatório e existente, e proteção contra remover contato com histórico.
4. Aceitação dos seis estados e rejeição de estado inválido ou nulo.
5. Coerência entre estado e data de encerramento.
6. Uma conversa aberta e várias encerradas no mesmo contato, preservando três ciclos.
7. Duas inserções concorrentes produzindo somente uma conversa aberta.
8. Nova execução sem reaplicar a migração ou alterar os atendimentos gravados.
9. Reversão que remove conversas e seu índice parcial, preserva contatos e permite reaplicar.

O comando `test:integration` da API aponta explicitamente para os arquivos de contatos e conversas. Cada suíte usa um banco descartável próprio, portanto a reversão de contatos em uma suíte não interfere nas conversas da outra. A execução conjunta foi verificada com sucesso em 05/11/2026, incluindo a limpeza dos bancos no encerramento de cada suíte.

A primeira execução enviada pelo autor revelou uma asserção incorreta no teste de vínculo histórico. A inserção com contato inexistente retorna `23503` (`foreign_key_violation`), mas a exclusão de um contato referenciado, com `ON DELETE RESTRICT`, retornou `23001` (`restrict_violation`) no PostgreSQL 18. Foi corrigida somente a expectativa dessa exclusão, mantendo a checagem do nome da chave estrangeira. O SQL e a proteção do histórico não precisaram mudar. As duas falhas do relatório inicial eram o cenário e seu agrupador, decorrentes da mesma asserção.

## 6. Verificações realizadas e aplicação posterior

Foram executados `npm run check` e `npm run test:integration`, ambos com sucesso após a correção. O primeiro continua sem abrir conexão ou aplicar SQL; o segundo valida as duas suítes em bancos descartáveis no PostgreSQL local.

Depois da revisão do autor, `npm run db:migrate` poderá aplicar o arquivo pendente no banco do projeto. Esse comando não foi executado nesta correção. A conferência da tabela e do histórico em `copilot_leads` continua para essa aplicação acompanhada.

Referências: [chaves estrangeiras e CHECK](https://www.postgresql.org/docs/18/ddl-constraints.html), [códigos de erro](https://www.postgresql.org/docs/18/errcodes-appendix.html), [índices parciais](https://www.postgresql.org/docs/18/indexes-partial.html), [CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html) e [DROP TABLE](https://www.postgresql.org/docs/18/sql-droptable.html).
