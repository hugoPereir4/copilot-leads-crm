# Copiloto de Leads WhatsApp

Projeto de portfólio e estudo de arquitetura: recepção administrativa de uma clínica fictícia de fisioterapia, com qualificação de solicitações e organização em Kanban.

O backend seguirá um monólito modular. O código está organizado em um monorepo com npm workspaces.

## Estado atual

A v1 planejada para esta etapa está implementada e roda localmente pelo simulador: webhook, fila em tabela, respostas predefinidas, qualificação administrativa (simulada por padrão, Gemini opcional), Kanban com cinco colunas, assunção, encerramento, login de atendentes e acesso de demonstração. O histórico das entregas está no [documento 36](docs/36-historico-de-etapas.md).

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
| `npm run test:integration` | Executa as suítes de migrações, recepção e contexto de mensagens, reserva, finalização e recuperação de jobs, cada uma em seu próprio banco descartável |
| `npm run start:api` | Compila a API e inicia o servidor em `127.0.0.1`, usando `.env`; exige PostgreSQL disponível |
| `npm run start:demo` | Compila os três pacotes e inicia API, worker do simulador e telas locais; exige as migrações aplicadas, inclusive a de atendentes |
| `npm run simulate:message` | Envia o exemplo versionado ao webhook local; a API precisa estar em outro terminal |
| `npm run db:check` | Compila a API, carrega o `.env` e consulta o banco pela conexão da aplicação |
| `npm run db:migrate` | Compila a API e aplica migrações pendentes; pode alterar a estrutura do banco |
| `npm run attendant:create -- <usuario> "<nome>"` | Compila a API e cria um atendente; a senha é pedida no terminal, sem eco, e confirmada |
| `npm run attendant:set-password -- <usuario>` | Compila a API, troca a senha do atendente e encerra todas as sessões dele |
| `npm run attendant:seed-demo` | Compila a API e cria o atendente de demonstração com `DEMO_USERNAME` e `DEMO_PASSWORD` do `.env`; se ele já existe, troca a senha e encerra as sessões dele. Não pergunta nada no terminal |

### Login dos atendentes

O painel (`/admin`), o simulador (`/simulator`) e as rotas `/api/demo/*` exigem login. Fluxo local:

1. `npm run db:migrate`, depois de revisar a migração de atendentes;
2. `npm run attendant:create -- hugo "Hugo"`, digitando e confirmando a senha (12 a 128 caracteres);
3. `npm run start:demo` e abrir `http://127.0.0.1:3000/admin`, que redireciona para `/login`.

Variáveis no `.env` (padrões em `.env.example`): `SESSION_TTL_HOURS` (1 a 24, padrão 12) e `SESSION_COOKIE_SECURE` (`true` ou `false`, padrão `false`). O servidor só fala HTTP em `127.0.0.1`; expor o painel fora do loopback exige HTTPS e `SESSION_COOKIE_SECURE=true`.

## Rodar localmente

Caminho curto para abrir o painel com o atendente de demonstração, sem criar conta. Na raiz do repositório:

1. `npm ci`
2. Copie `.env.example` para `.env`.
3. No `.env`, preencha `POSTGRES_PASSWORD` com uma senha local qualquer e `DEMO_PASSWORD` com a senha de demonstração abaixo. Deixe `DEMO_USERNAME=demo`.
4. `docker compose up -d postgres`
5. `npm run db:migrate`
6. `npm run attendant:seed-demo`
7. `npm run start:demo`
8. Abra `http://127.0.0.1:3000/login` e entre com o acesso de demonstração, que também aparece na própria tela de login.

| Acesso de demonstração | Valor |
|---|---|
| Usuário | `demo` |
| Senha | `demo-copilot-leads-2026` |

**A senha desta tabela precisa ser a mesma definida como `DEMO_PASSWORD` no deploy.** Se o `DEMO_PASSWORD` do deploy mudar, atualize esta tabela e rode `npm run attendant:seed-demo` de novo no ambiente do deploy; a tela de login sempre mostra o valor do ambiente. As credenciais são públicas por design e dão acesso só a dados sintéticos. Limites e cuidados estão no [documento 35](docs/35-acesso-de-demonstracao.md).

## Estrutura e dependências

```text
apps/api          Backend e worker
apps/web          Dashboard dos atendentes
packages/shared   Contratos públicos usados pelas duas aplicações
docs              Planejamento e guias de revisão
```

API e web dependem de `shared`. As aplicações trocam dados por HTTP; o dashboard não importa a implementação do backend. O pacote compartilhado contém somente contratos públicos e não depende das aplicações.

## Revisão e aprendizado

- [Login de atendentes](docs/34-login-de-atendentes.md): sessão no servidor, cookie, Origin, scrypt, CLI de atendentes e teste manual.
- [Backlog técnico](docs/33-backlog-tecnico.md): pendências da revisão completa (bugs suspeitos, divergências de documentação, testes e observabilidade), para tratar depois das funcionalidades básicas da v1.
- [Leitura do plano persistido](docs/28-etapa-4-leitura-do-plano-de-resposta.md): etapa 4.20, conteúdo original, progresso, validação e fotografia de leitura.
- [Preparação PostgreSQL dos planos](docs/27-etapa-4-preparacao-postgresql-do-plano.md): etapa 4.19, transação, retomada, bloqueios e rollback.
- [Migração dos planos de resposta](docs/26-etapa-4-migracao-dos-planos-de-resposta.md): etapa 4.18, chaves compostas, unicidades e testes em bancos descartáveis.
- [Contrato do plano de resposta](docs/25-etapa-4-contrato-do-plano-de-resposta.md): etapa 4.17, modelagem, abertura preparada/enviada e contrato de gravação atômica.
- [Composição e expediente](docs/24-etapa-4-composicao-de-mensagens.md): etapa 4.16, textos do perfil, preços e cálculo de horários com instante explícito.
- [Decisão por estado](docs/23-etapa-4-decisao-de-processamento.md): etapa 4.15, intenções, abertura explícita e limites para a execução futura.
- [Perfil do negócio](docs/22-etapa-4-perfil-do-negocio.md): etapa 4.14, configuração JSON, validação e porta de leitura.
- [Contexto da mensagem](docs/21-etapa-4-contexto-da-mensagem.md): etapa 4.13, leitura por vínculo original, schema e limites de concorrência.
- [Recuperação de jobs](docs/20-etapa-4-recuperacao-de-jobs.md): etapa 4.12, expiração, recuperação por lote e proteção contra tentativas antigas.
- [Finalização de jobs](docs/19-etapa-4-finalizacao-de-jobs.md): etapa 4.11, conclusão, reagendamento, falhas e proteção da tentativa atual.
- [Reivindicação de jobs](docs/18-etapa-4-reivindicacao-de-jobs.md): etapa 4.10, reserva atômica, concorrência e roteiro de revisão.
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
