# Copiloto de Leads WhatsApp

Projeto de portfólio e estudo de arquitetura: recepção administrativa de uma clínica fictícia de fisioterapia, com qualificação de solicitações e organização em Kanban.

O backend seguirá um monólito modular. O código está organizado em um monorepo com npm workspaces.

## Estado atual

A etapa 3 preparou os pacotes, a tipagem estrita e os scripts de verificação. A etapa 4.1 preparou o PostgreSQL local com Docker Compose e validou a persistência após recriar o container. A etapa 4.2 configurou o acesso com `pg`, a validação de ambiente com Zod e o controle de migrações com `node-pg-migrate`. A conexão pelo Node fora do container foi verificada. A API agora tem a entrada HTTP local descrita na etapa 4.9; as demais funcionalidades continuam em entregas pequenas, com revisão individual.

A etapa 4.3 foi revisada e verificada: os oito cenários de integração da migração de `contacts` passaram em banco descartável, e sua limpeza foi confirmada. Uma consulta de leitura também encontrou a migração registrada e a tabela correspondente em `copilot_leads`. O [documento 11](docs/11-etapa-4-migracao-de-contatos.md) registra os resultados e os comandos.

A etapa 4.4 foi revisada e enviada ao remoto: migração de `conversations`, com vínculo ao contato e unicidade da conversa aberta. Em 05/11/2026, a execução conjunta dos testes de integração de contatos e conversas passou após corrigir uma expectativa de erro no teste de exclusão restrita. O [documento 12](docs/12-etapa-4-migracao-de-conversas.md) registra essa validação em bancos descartáveis.

A etapa 4.5 foi revisada e enviada ao remoto na branch `feat/messages-migration`, commit `f4c7795`: migração de `messages`, com vínculo à conversa, identificação do tipo de conteúdo e unicidade por provedor e ID externo. Tipagem, compilação, seis testes de configuração e os 30 registros de integração passaram nessa entrega. O [documento 13](docs/13-etapa-4-migracao-de-mensagens.md) apresenta a implementação e seus limites.

A etapa 4.6 foi revisada e enviada ao remoto na branch `feat/jobs-migration`: commits `c8f1be3` (encerramento de conexões nos testes) e `b4a5f8f` (migração de `jobs`, testes e documentação). Tipagem, compilação, seis testes de configuração e 42 registros de integração passaram nessa entrega. O [documento 14](docs/14-etapa-4-migracao-de-jobs.md) apresenta a implementação.

A etapa 4.7 foi revisada e enviada ao remoto na branch `feat/message-reception-contract`: primeiro bloco do módulo de mensageria, com contrato de mensagem normalizada, validação de entrada e caso de uso dependente de uma porta de persistência. `npm run check` passou com 16 testes sem banco nessa entrega. O [documento 15](docs/15-etapa-4-contrato-de-recepcao.md) apresenta o fluxo e a ordem de revisão.

A etapa 4.8 foi revisada e enviada ao remoto na branch `feat/postgres-message-reception`, com os commits `8f49d0d` e `d75bf3e`: persistência transacional e documentação. Tipagem, compilação, 20 testes sem banco e 55 registros de integração passaram nessa entrega. O [documento 16](docs/16-etapa-4-recepcao-postgresql.md) registra as garantias verificadas.

A etapa 4.9 foi revisada e validada na branch `feat/simulator-webhook`: webhook Express local, adapter do simulador e comando para enviar um exemplo sintético. Tipagem, compilação, 43 registros de testes sem banco e 56 de integração passaram. O autor também aprovou os dez cenários manuais no Postman, com persistência conferida por consultas de leitura. Worker, respostas automáticas e painel ainda não estão implementados. O [documento 17](docs/17-etapa-4-webhook-simulador.md) apresenta a ordem de revisão, a execução manual e seus resultados.

## Ambiente

- Node.js `24.14.1`, registrado em `.nvmrc`.
- npm `11.11.0`, registrado em `packageManager` no `package.json`.
- Os intervalos aceitos estão em `engines`; `.npmrc` habilita a verificação de compatibilidade.

## Instalação e verificação

Execute os comandos na raiz do repositório:

```sh
npm ci
npm run check
```

`npm ci` instala as dependências registradas no `package-lock.json`. O script `check` verifica os tipos dos três pacotes, compila a base e executa os testes de configuração e recepção da API, que não precisam de banco nem de `.env`.

| Script | Finalidade |
|---|---|
| `npm run typecheck` | Compila a interface pública de `shared` e verifica os tipos de todos os pacotes, sem emitir os arquivos das aplicações |
| `npm run build` | Compila primeiro `shared`, depois API e web, gerando arquivos em seus diretórios `dist` |
| `npm run check` | Executa a verificação de tipos, a compilação e os testes da API |
| `npm run test` | Compila a API e executa os testes sem precisar de banco |
| `npm run test:integration` | Executa as suítes de migrações e recepção PostgreSQL, cada uma em seu próprio banco descartável |
| `npm run start:api` | Compila a API e inicia o servidor em `127.0.0.1`, usando `.env`; exige PostgreSQL disponível |
| `npm run simulate:message` | Envia o exemplo versionado ao webhook local; a API precisa estar em outro terminal |
| `npm run db:check` | Compila a API, carrega o `.env` e consulta o banco pela conexão da aplicação |
| `npm run db:migrate` | Compila a API e aplica migrações pendentes; pode alterar a estrutura do banco |

## Estrutura e dependências

```text
apps/api          Backend e worker
apps/web          Dashboard dos atendentes
packages/shared   Contratos públicos usados pelas duas aplicações
docs              Planejamento e guias de revisão
```

API e web dependem de `shared`. As aplicações trocam dados por HTTP; o dashboard não importa a implementação do backend. O pacote compartilhado contém somente contratos públicos e não depende das aplicações.

## Revisão e aprendizado

- [Webhook do simulador](docs/17-etapa-4-webhook-simulador.md): etapa 4.9, Express, formato externo e roteiro de revisão e execução.
- [Recepção PostgreSQL](docs/16-etapa-4-recepcao-postgresql.md): etapa 4.8, com transação, concorrência e rollback.
- [Contrato de recepção](docs/15-etapa-4-contrato-de-recepcao.md): etapa 4.7, com validação, caso de uso e porta de persistência.
- [Migração de jobs](docs/14-etapa-4-migracao-de-jobs.md): SQL, testes e resultados da etapa 4.6.
- [Migração de mensagens](docs/13-etapa-4-migracao-de-mensagens.md): SQL, testes e resultados da etapa 4.5.
- [Migração de conversas](docs/12-etapa-4-migracao-de-conversas.md): SQL, testes e resultados da etapa 4.4.
- [Primeira migração de contatos](docs/11-etapa-4-migracao-de-contatos.md): SQL, testes de integração e resultados da etapa 4.3.
- [Acesso ao banco e migrações](docs/10-etapa-4-acesso-ao-banco.md): entrega da etapa 4.2, dependências, configuração e validação.
- [PostgreSQL local com Docker Compose](docs/09-etapa-4-postgres-local.md): configuração e primeira execução explicadas passo a passo.
- [Guia da entrega da etapa 3](docs/08-etapa-3-base-do-monorepo.md): instalações, configurações e roteiro de revisão.
- [Decisões de arquitetura](docs/02-decisoes-de-arquitetura.md).
- [Fluxo de desenvolvimento e revisão](docs/07-fluxo-de-desenvolvimento.md).
