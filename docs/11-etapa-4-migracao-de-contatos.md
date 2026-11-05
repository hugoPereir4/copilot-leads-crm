# Etapa 4.3 — Primeira migração de negócio: contatos

Preparada em 04/11/2026 na branch `feat/contacts-migration`, a partir da etapa 4.2 revisada pelo autor.

**Estado:** revisão e verificações concluídas após autorização do autor. `npm run check` passou na tipagem dos três pacotes, compilação e seis testes de configuração. `npm run test:integration` passou nos oito cenários e no teste que os agrupa, totalizando nove registros aprovados pelo Node. A migração foi aplicada, revertida e reaplicada somente em banco descartável, cuja remoção foi confirmada. Uma conferência de leitura em `copilot_leads` encontrou `contacts`, suas colunas e restrições esperadas e o registro `1793750400000_create_contacts` em `pgmigrations`. Não foi necessário executar `db:migrate` no banco do projeto nesta revisão.

## 1. Ordem de revisão e dependências

| Ordem | Arquivo | Responsabilidade |
|---|---|---|
| 1 | [1793750400000_create_contacts.sql](../apps/api/migrations/1793750400000_create_contacts.sql) | Definir criação e reversão da tabela, seus padrões e restrições |
| 2 | [contacts-migration.integration.test.ts](../apps/api/src/infrastructure/database/contacts-migration.integration.test.ts) | Usar a migração em um banco descartável e verificar seus efeitos reais |
| 3 | [package.json da API](../apps/api/package.json) e [da raiz](../package.json) | Disponibilizar a execução explícita do teste de integração |
| 4 | [modelagem de dados](04-modelagem-de-dados.md) | Conferir se o SQL e o modelo documentado representam a mesma proposta |

O prefixo numérico do arquivo SQL é um identificador de tempo para ordenação. O nome é registrado pelo migrador em `pgmigrations`. A ferramenta já estava instalada e o script `db:migrate` da etapa 4.2 continua o mesmo; agora existe um arquivo pendente que ele poderá aplicar.

O teste reutiliza `readDatabaseConfig` e `createDatabasePool` da etapa 4.2. O migrador recebe a configuração do banco descartável e administra sua própria conexão. Não foram instalados novos pacotes nem alterados `.env` ou credenciais.

## 2. Ler a migração SQL

| Campo | Definição | Motivo |
|---|---|---|
| `id` | `uuid NOT NULL DEFAULT gen_random_uuid()` | Identificador do contato, com UUID aleatório gerado pelo banco quando omitido |
| `phone` | `text NOT NULL` | Telefone obrigatório, preservando sua representação textual com `+` |
| `display_name` | `text`, permitindo `NULL` | Nome ainda pode ser desconhecido ao receber a primeira mensagem |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Instante de criação, com padrão correspondente ao início da transação |

Um valor padrão é usado quando a coluna é omitida; ele não substitui um `NULL` enviado explicitamente. `timestamptz` representa um instante e sua exibição depende do fuso da sessão; não armazena o nome do fuso da clínica. O PostgreSQL 18 já fornece `gen_random_uuid()` sem instalar uma extensão nesta entrega.

As restrições têm nomes explícitos:

- `contacts_pkey`: chave primária do identificador.
- `contacts_phone_key`: unicidade do telefone. O PostgreSQL cria o índice necessário para essa restrição; não adicionamos um segundo índice equivalente.
- `contacts_phone_format_check`: exige `+` seguido de 2 a 15 dígitos, com o primeiro dígito diferente de zero. A expressão `^[+][1-9][0-9]{1,14}$` confere a representação inteira e rejeita espaços, parênteses e telefone vazio.

Essa representação canônica é compatível com o limite de 15 dígitos da E.164. A expressão não valida códigos de país, regras nacionais, existência ou titularidade do telefone. A normalização da entrada será responsabilidade do futuro caso de uso, antes de persistir. Isso permite que a unicidade compare uma representação consistente; não se deve esperar que o banco transforme formatos recebidos.

O `Up Migration` cria `public.contacts`. O `Down Migration` remove essa tabela e seus dados. A reversão não usa `CASCADE`, portanto não elimina automaticamente futuras dependências de outras tabelas.

Não usamos `CREATE TABLE IF NOT EXISTS`: se existir uma tabela criada fora do histórico, queremos identificar o conflito. A reaplicação é controlada pelo histórico do migrador, não por ignorar a existência de uma tabela potencialmente diferente.

## 3. Relação com a arquitetura

O contato representa a pessoa; conversa representa um ciclo de atendimento e lead representa a solicitação. Começar por `contacts` permite que as futuras conversas referenciem um contato já identificado. As demais tabelas continuam para entregas posteriores.

Esta migração é uma implementação da estrutura de persistência. A chave única protege o cadastro mesmo quando duas operações concorrentes tentam inserir o mesmo telefone. Isso ainda não implementa a reutilização do cadastro, nem garante sozinho uma conversa ou um lead aberto por contato: esses comportamentos exigirão seus próprios casos de uso e restrições.

Ainda não foram criados repositório, caso de uso, rota Express ou código no pacote compartilhado. Os tipos e detalhes SQL permanecem no backend, conforme D2 e D22.

## 4. Teste de integração

O teste foi executado com sucesso após autorização do autor. Ele utiliza o PostgreSQL local já configurado e exige que o usuário tenha permissão para criar bancos. O usuário inicial da imagem Docker possui essa permissão.

Ao ser executado, conecta ao banco configurado apenas para administrar um novo banco chamado `copilot_contacts_test_<uuid>`. As migrações e inserções usam exclusivamente esse banco novo, criado a partir de `template0`. O teste aceita apenas endereços de loopback e não permite fornecer o nome do banco descartável pelo ambiente.

A limpeza fecha o pool e remove apenas o banco cujo `CREATE DATABASE` teve sucesso nessa execução. Uma falha na criação não autoriza remover um banco existente. As tabelas do banco `copilot_leads` não são usadas nas verificações nem removidas pela limpeza.

Os oito cenários abaixo passaram:

1. Aplicação da migração e registro do nome no histórico.
2. Inserção com UUID e data padrão, permitindo nome ausente.
3. Rejeição de telefone, identificador e data nulos.
4. Rejeição de telefone vazio ou fora da representação escolhida.
5. Rejeição de telefone duplicado pela restrição única.
6. Duas inserções concorrentes resultando em um único cadastro.
7. Nova execução de `up` sem reaplicar a migração ou remover dados.
8. Reversão, remoção do registro do histórico e possibilidade de aplicar novamente.

Os dados usados são sintéticos. O teste seleciona pelo nome apenas a migração de contatos, para não aplicar automaticamente as migrações de outras entregas. As funções da ferramenta de migrações não foram substituídas por um migrador próprio.

## 5. Validação executada

Após a revisão do código, foi executado o teste no banco descartável:

```powershell
npm run test:integration
```

Na validação da etapa 4.3, esse comando compilava a API e executava somente o arquivo de contatos, criando e removendo um banco de teste. Na etapa 4.4, passou a incluir também o arquivo de conversas, em outro banco descartável; a execução conjunta foi verificada com sucesso em 05/11/2026, conforme o [documento 12](12-etapa-4-migracao-de-conversas.md). Os testes de integração não fazem parte de `npm run check` nem de `npm run test`, que continuam sem depender de PostgreSQL ou Docker.

O comando existente para aplicar migrações no banco do projeto é:

```powershell
npm run db:migrate
```

Não foi necessário executar esse comando nesta revisão: uma consulta de leitura encontrou a tabela `public.contacts` e seu registro em `public.pgmigrations`. Foram conferidos os quatro campos, tipos, valores padrão, nulabilidade, chave primária, unicidade de telefone e restrição de formato. Não foram lidos dados de contatos nem alteradas tabelas desse banco. A conferência também encontrou zero bancos com o prefixo de testes após a execução. O comando `db:migrate` continua aplicando apenas `up`; o teste de reversão ocorre no banco descartável.

As verificações no PostgreSQL complementaram a tipagem, a compilação e os testes de configuração: foram exercitados aplicação, restrições, concorrência, histórico e reversão, com limpeza do banco descartável. Os arquivos revisados pertencem somente à etapa 4.3; `.env` e credenciais não entram no versionamento.

Referências: [restrições no PostgreSQL](https://www.postgresql.org/docs/18/ddl-constraints.html), [UUIDs](https://www.postgresql.org/docs/18/functions-uuid.html), [tipos de data e hora](https://www.postgresql.org/docs/18/datatype-datetime.html), [CREATE DATABASE](https://www.postgresql.org/docs/18/sql-createdatabase.html), [DROP DATABASE](https://www.postgresql.org/docs/18/sql-dropdatabase.html) e [ITU-T E.164](https://www.itu.int/rec/T-REC-E.164/).
