# Etapa 4.2 — Acesso ao PostgreSQL e controle de migrações

Implementada em 30/10/2026 na branch `chore/api-database`, criada sobre a entrega 4.1 enviada ao remoto. A revisão individual e a integração na `main` continuam separadas. A escolha de ferramentas foi confirmada pelo autor e registrada na D22.

**Estado:** implementação pronta para revisão. Tipagem, compilação e seis testes passaram. A consulta pelo Node fora do container retornou o banco e o usuário esperados. O migrador inicializou seu controle e terminou sem migrações pendentes. Não há arquivos de migração de negócio nesta entrega; executar uma migração com alterações em tabelas será validado na próxima entrega.

## 1. O que foi instalado

As versões estáveis foram consultadas no registro npm e fixadas no `package.json` da API. O `package-lock.json` da raiz registra também as dependências transitivas. Node `24.14.1` e npm `11.11.0` já estavam instalados.

| Pacote | Versão | Categoria na API | Função |
|---|---|---|---|
| `pg` | `8.23.1` | Execução | Conectar ao PostgreSQL e executar SQL |
| `zod` | `4.6.7` | Execução | Validar a configuração recebida do ambiente |
| `@types/pg` | `8.23.1` | Desenvolvimento | Tipos TypeScript do driver |
| `node-pg-migrate` | `9.0.0` | Desenvolvimento | Aplicar migrações e registrar quais foram executadas |

Comandos usados, na raiz:

```powershell
npm install --workspace=@copilot-leads/api --save-exact --ignore-scripts pg@8.23.1 zod@4.6.7
npm install --workspace=@copilot-leads/api --save-dev --save-exact --ignore-scripts node-pg-migrate@9.0.0 @types/pg@8.23.1
```

`--workspace` declara a dependência na API, mesmo que o npm armazene o pacote no `node_modules` da raiz. `--ignore-scripts` evitou executar scripts de instalação de dependências. As duas instalações terminaram com zero vulnerabilidades reportadas pelo npm naquele momento. Depois de obter o projeto, use `npm ci` para reproduzir o lock em vez de repetir as instalações individuais.

O migrador está em desenvolvimento porque estamos preparando o ambiente local. Um futuro processo de deploy que execute migrações precisará instalar essa ferramenta; `npm ci --omit=dev` sozinho não a disponibiliza.

## 2. Arquivos para revisar, nesta ordem

| Arquivo | Responsabilidade |
|---|---|
| [.env.example](../.env.example) | Modelo de configuração, incluindo o endereço usado pela API |
| [database.ts](../apps/api/src/config/database.ts) | Ler e validar o ambiente e derivar o tipo da configuração |
| [pool.ts](../apps/api/src/infrastructure/database/pool.ts) | Criar o pool do driver PostgreSQL |
| [check-database.ts](../apps/api/src/scripts/check-database.ts) | Compor configuração e pool para executar uma consulta de conexão |
| [migrate-database.ts](../apps/api/src/scripts/migrate-database.ts) | Compor configuração e ferramenta de migrações |
| [database.test.ts](../apps/api/src/config/database.test.ts) | Verificar a fronteira de configuração sem banco |
| [package.json da API](../apps/api/package.json) e [da raiz](../package.json) | Declarar dependências e comandos |

O diretório `apps/api/migrations` está reservado para arquivos SQL. O `.gitkeep` mantém o diretório vazio no Git e é ignorado pelo carregador de migrações da ferramenta.

## 3. Como a configuração funciona

Os comandos npm da raiz encaminham a execução para o workspace da API, compilando-o primeiro. O Node carrega o `.env` da raiz com `--env-file=../../.env`, relativo ao diretório desse workspace. Não foi instalada uma biblioteca de leitura de `.env`. Variáveis já definidas no ambiente do processo têm precedência sobre o arquivo.

O código reutiliza `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_PORT`, já usados no Compose. `POSTGRES_HOST` foi acrescentado ao exemplo e tem padrão `127.0.0.1`; não foi necessário alterar o `.env` existente. A porta padrão é `5432`, mas nesta máquina o `.env` define `15432`, conforme a etapa 4.1.

```text
Node no Windows → 127.0.0.1:15432 → PostgreSQL:5432 no container
```

O Zod exige banco, usuário e senha, converte a porta para número e aceita apenas inteiros entre 1 e 65535. A senha é preservada sem remover espaços ou transformar caracteres. A configuração é passada ao driver como objeto, evitando montar uma URL e precisar codificar caracteres especiais da senha.

Em caso de configuração inválida, o erro informa apenas os nomes dos campos. Falhas de conexão e migração produzem mensagens gerais, sem imprimir objetos de configuração, valores de ambiente ou erros brutos do driver. Isso limita o diagnóstico disponível no terminal; os logs serão aprimorados na entrega de observabilidade, preservando esse cuidado com credenciais.

## 4. Pool e separação de responsabilidades

Um pool administra um conjunto de conexões que podem ser reutilizadas pelas consultas. Criar o pool não abre imediatamente todas elas: o driver as cria conforme necessário. Nesta entrega, o limite é cinco conexões, com espera de conexão de cinco segundos, consulta limitada a cinco segundos e descarte de conexão ociosa após dez segundos. São parâmetros iniciais de infraestrutura para desenvolvimento local, não regras da clínica.

`createDatabasePool` é uma função: importar o arquivo não lê o ambiente nem abre uma conexão global. O script de verificação compõe as peças, executa uma consulta e chama `pool.end()` em `finally` para liberar os recursos, inclusive quando a consulta falha.

O monólito modular ainda será construído. Este bloco prepara infraestrutura usada pelos futuros repositórios. As regras de atendimento ficarão nos casos de uso; SQL e `pg` ficarão nas implementações de acesso a dados. Ainda não há regra de negócio que justifique criar interfaces de repositório ou um gerenciador de transações nesta entrega.

Ao implementar mensagem e job na mesma transação, reservaremos um cliente do pool para todas as operações dessa transação, conforme a D22. Consultas isoladas como a verificação atual podem usar `pool.query`.

## 5. Executar e conferir

Mantenha o Docker Desktop aberto e o PostgreSQL em execução. Esta etapa usa o mesmo container e volume da etapa 4.1; não exige outra imagem ou recriação. Se o serviço estiver parado, o comando abaixo inicia o serviço reutilizando o volume:

```powershell
docker compose up -d --wait --wait-timeout 120 postgres
```

Na raiz, execute a consulta pelo Node:

```powershell
npm run db:check
```

Resultado já verificado nesta implementação:

```text
Conexão validada. Banco: copilot_leads. Usuário: copilot_dev.
```

Diferentemente da consulta com `docker compose exec` da etapa 4.1, este comando usa o Node no Windows e a porta publicada do banco. Ele apenas consulta informações da sessão.

O comando a seguir pode alterar a estrutura do banco. Ele aplica os arquivos SQL pendentes em ordem e mantém seu histórico em `public.pgmigrations`:

```powershell
npm run db:migrate
```

Nesta entrega, inicializou apenas a tabela técnica de histórico e respondeu:

```text
No migrations to run!
Migrações aplicadas nesta execução: 0.
```

`pgmigrations` pertence à ferramenta e não é uma tabela de negócio. O script configura verificação de ordem e uma transação para o conjunto de migrações pendentes; o bloqueio de concorrência da ferramenta permanece habilitado. A inicialização da tabela de histórico é feita pela própria ferramenta antes desse conjunto de migrações.

Não há execução automática de migrações ao importar o pool. O comando atual aplica apenas a direção `up`; geração de arquivos e reversões serão explicadas quando houver uma primeira migração concreta. As migrações SQL usarão as seções `-- Up Migration` e `-- Down Migration` reconhecidas pelo `node-pg-migrate`. Não edite uma migração já compartilhada e aplicada para representar uma mudança nova: crie outro arquivo para preservar o histórico.

## 6. Testes e critério de revisão

```powershell
npm run check
```

O comando verifica tipos dos três workspaces, compila os pacotes e executa seis testes com o módulo `node:test`, incluído no Node. Os testes não dependem de `.env`, Docker ou acesso ao banco. Cobrem configuração válida, valores padrão, limites da porta, campos obrigatórios, nomes vazios e mensagens sem exposição dos valores recebidos. Não são testes de consultas de negócio ou de migrações aplicadas; essas verificações serão acrescentadas junto das implementações correspondentes.

Na revisão, acompanhe o caminho do dado: variável de ambiente → validação Zod → configuração tipada → driver. Depois compare os dois scripts: um usa um pool para ler informações; o outro entrega a mesma configuração ao migrador, que administra sua própria conexão. Observe que nenhum desses detalhes foi colocado em `packages/shared` ou no frontend.

A próxima entrega é revisar o primeiro conjunto de tabelas necessário ao recebimento de mensagens e escrever uma migração de negócio pequena, com verificação das restrições pertinentes. Express, webhook, worker e regras da conversa continuam para suas próprias entregas.

Referências oficiais: [conexões com pg](https://node-postgres.com/features/connecting), [pool](https://node-postgres.com/apis/pool), [transações](https://node-postgres.com/features/transactions), [Zod](https://zod.dev/basics), [node-pg-migrate](https://salsita.github.io/node-pg-migrate/) e [variáveis de ambiente no Node](https://nodejs.org/docs/latest-v24.x/api/cli.html#--env-filefile).
