# Copiloto de Leads WhatsApp

Projeto de portfólio e estudo de arquitetura: recepção administrativa de uma clínica fictícia de fisioterapia, com qualificação de solicitações e organização em Kanban.

O backend seguirá um monólito modular. O código está organizado em um monorepo com npm workspaces.

## Estado atual

A etapa 3 prepara os pacotes, a tipagem estrita e os scripts de verificação. Os pontos de entrada dos pacotes ainda estão vazios; as funcionalidades serão construídas em entregas pequenas, com revisão individual.

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

`npm ci` instala as dependências registradas no `package-lock.json`. O script `check` verifica os tipos dos três pacotes e compila a base.

| Script | Finalidade |
|---|---|
| `npm run typecheck` | Compila a interface pública de `shared` e verifica os tipos de todos os pacotes, sem emitir os arquivos das aplicações |
| `npm run build` | Compila primeiro `shared`, depois API e web, gerando arquivos em seus diretórios `dist` |
| `npm run check` | Executa a verificação de tipos e a compilação |

## Estrutura e dependências

```text
apps/api          Backend e worker
apps/web          Dashboard dos atendentes
packages/shared   Contratos públicos usados pelas duas aplicações
docs              Planejamento e guias de revisão
```

API e web dependem de `shared`. As aplicações trocam dados por HTTP; o dashboard não importa a implementação do backend. O pacote compartilhado contém somente contratos públicos e não depende das aplicações.

## Revisão e aprendizado

- [Guia da entrega da etapa 3](docs/08-etapa-3-base-do-monorepo.md): instalações, configurações e roteiro de revisão.
- [Decisões de arquitetura](docs/02-decisoes-de-arquitetura.md).
- [Fluxo de desenvolvimento e revisão](docs/07-fluxo-de-desenvolvimento.md).
