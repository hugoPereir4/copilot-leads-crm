# Copiloto de Leads WhatsApp

Projeto de portfólio e estudo de arquitetura: recepção administrativa de uma clínica fictícia de fisioterapia, com qualificação de solicitações e organização em Kanban.

O backend seguirá um monólito modular. O código está organizado em um monorepo com npm workspaces.

## Estado atual

A etapa 3 preparou os pacotes, a tipagem estrita e os scripts de verificação. A etapa 4.1 preparou o PostgreSQL local com Docker Compose e validou a persistência após recriar o container. A etapa 4.2 configurou o acesso com `pg`, a validação de ambiente com Zod e o controle de migrações com `node-pg-migrate`. A conexão pelo Node fora do container foi verificada. Os pontos de entrada HTTP continuam vazios; ainda não há tabelas de negócio. As funcionalidades serão construídas em entregas pequenas, com revisão individual.

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

`npm ci` instala as dependências registradas no `package-lock.json`. O script `check` verifica os tipos dos três pacotes, compila a base e executa os testes de configuração da API, que não precisam de banco nem de `.env`.

| Script | Finalidade |
|---|---|
| `npm run typecheck` | Compila a interface pública de `shared` e verifica os tipos de todos os pacotes, sem emitir os arquivos das aplicações |
| `npm run build` | Compila primeiro `shared`, depois API e web, gerando arquivos em seus diretórios `dist` |
| `npm run check` | Executa a verificação de tipos, a compilação e os testes da API |
| `npm run test` | Compila a API e executa os testes sem precisar de banco |
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

- [Acesso ao banco e migrações](docs/10-etapa-4-acesso-ao-banco.md): entrega da etapa 4.2, dependências, configuração e validação.
- [PostgreSQL local com Docker Compose](docs/09-etapa-4-postgres-local.md): configuração e primeira execução explicadas passo a passo.
- [Guia da entrega da etapa 3](docs/08-etapa-3-base-do-monorepo.md): instalações, configurações e roteiro de revisão.
- [Decisões de arquitetura](docs/02-decisoes-de-arquitetura.md).
- [Fluxo de desenvolvimento e revisão](docs/07-fluxo-de-desenvolvimento.md).
