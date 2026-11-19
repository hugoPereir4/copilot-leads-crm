# Acesso de demonstração

Branch `feat/demo-attendant`, baseada em `fix/remove-filtro-encerrados` (`92fd2f2`). Sem migração, sem dependência nova, sem merge na `main`. Reaproveita o login da [D23](02-decisoes-de-arquitetura.md#d23-autenticação-de-atendentes-por-sessão-no-servidor) e o [documento 34](34-login-de-atendentes.md).

## Escopo

Quem avalia o projeto (por exemplo, um recrutador) entra no painel do deploy sem criar conta, com um atendente de demonstração que já existe no sistema de login.

- **Variáveis opcionais:** `DEMO_USERNAME` (mesmo formato de `usernameSchema`) e `DEMO_PASSWORD` (12 a 128 caracteres, `passwordSchema`).
- **Seed:** `npm run attendant:seed-demo` cria o atendente "Atendente de demonstração" ou, se ele já existe, troca a senha. Não pergunta nada no terminal.
- **Tela de login:** com as duas variáveis, `GET /login` mostra o bloco **Acesso de demonstração** com usuário e senha.
- **Sem as variáveis:** tudo funciona como antes, e `/login` devolve o mesmo arquivo de hoje, byte a byte.
- **O que não muda:** tabelas, cookie `copilot_session`, sessão no servidor, `SESSION_TTL_HOURS`, hash scrypt, guarda de sessão, `runAttendantCommand` e o `login.html` versionado. Não há variável de sessão nova.

| Situação | Resultado |
|---|---|
| Nenhuma das duas definida (ou as duas vazias) | Demonstração desligada; `/login` igual ao de hoje |
| Só uma definida | O startup da demonstração falha com `configuration_error` e o nome da variável que falta |
| Valor fora do contrato (usuário inválido, senha curta) | O startup falha citando só o nome da variável |
| As duas válidas | `/login` mostra o bloco; o login usa o fluxo normal da D23 |
| `attendant:seed-demo` sem as duas | Sai com código 1 e cita só os nomes das variáveis |

## Desenho

- **Configuração:** `readDemoAccessConfig` em `apps/api/src/config/auth.ts`. Ela segue o padrão de `readAuthConfig`: o mesmo `AuthConfigurationError` e mensagens só com nomes de variáveis. Vazio conta como ausente, para que um `.env` copiado do `.env.example` sem preencher nada desligue a demonstração em vez de quebrar.
- **Seed:** `seedDemoAttendant` em `apps/api/src/scripts/attendant-admin.ts`, com as mesmas dependências injetadas (`AttendantStore`, `PasswordHasher`) das funções vizinhas.
  - Chama `createAttendant`. O caminho é decidido pelo **status** `duplicado`, nunca por texto de erro.
  - Com `duplicado`, chama `setAttendantPassword`, que troca o hash e apaga as sessões do atendente na mesma transação. Trocar `DEMO_PASSWORD` e rodar o seed de novo passa a valer na hora.
  - **Proteção:** se o usuário existe e o nome de exibição não é "Atendente de demonstração", o seed se recusa a trocar a senha. Assim, `DEMO_USERNAME=hugo` por engano não redefine a senha de um atendente real.
- **Comando:** `runSeedDemoCommand` lê o ambiente e devolve o código de saída, e `attendant-seed-demo-cli.ts` faz só a composição com PostgreSQL. O stdin não é tocado e a senha nunca é impressa; a saída mostra só `id` e `username`.
- **Tela de login:** `apps/api/src/http/login-page.ts` insere o bloco antes do `<form id="login-form">`. O HTML é montado uma vez, quando `installPanel` é chamado; se o formulário mudar de forma e o ponto de inserção sumir, o startup falha. Todos os valores passam por escape HTML.
  - **Por que no servidor:** o repositório é público, e a senha do deploy não pode ficar no `login.html` versionado. O bloco é lido do ambiente de cada instalação.
  - **Sem as variáveis:** a rota continua usando `sendFile(login.html)`, o mesmo caminho de antes.
  - **Estilos:** o bloco usa `.muted` e as cores de `tokens.css`; o `login.css` ganhou só as regras `.demo-access`.

## Ordem de revisão

1. `apps/api/src/config/auth.ts` e `config/auth.test.ts`: regra das duas variáveis e mensagens sem valores.
2. `apps/api/src/scripts/attendant-admin.ts` (`seedDemoAttendant`, `runSeedDemoCommand`) e `attendant-admin.test.ts`.
3. `apps/api/src/scripts/attendant-seed-demo-cli.ts` e os scripts `attendant:seed-demo` nos dois `package.json`.
4. `apps/api/src/http/login-page.ts`, `http/panel.ts` (opção `demoAccess`) e `apps/api/src/demo.ts` (leitura no startup).
5. `apps/api/src/http/login-page.test.ts`: escape, `/login` sem e com as variáveis, startup com só uma variável.
6. `apps/web/src/styles/login.css`, `.env.example`, README (seção "Rodar localmente") e este documento.

## Verificações automatizadas

| Teste | O que cobre |
|---|---|
| `config/auth.test.ts` | Ausente ou vazio desliga; só uma variável, usuário inválido ou senha curta falham citando só o nome |
| `scripts/attendant-admin.test.ts` | O seed cria quando não existe; troca a senha e encerra sessões quando existe; recusa senha curta; não troca a senha de um atendente real com o mesmo usuário; sem variáveis, sai com 1 sem vazar valores e sem ler o terminal |
| `http/login-page.test.ts` | Escape HTML; o `login.html` versionado sem credenciais; `/login` sem as variáveis igual ao arquivo; com elas, o bloco com valores escapados e `Cache-Control: no-store`; o processo `demo.js` falhando com só uma variável e passando da etapa de demonstração sem nenhuma |

## Limitações

- **Credenciais públicas por design:** qualquer pessoa que abra `/login` ou o README entra no painel.
- **Webhook aberto:** `POST /webhooks/simulator` continua sem autenticação, como na D23. Qualquer visitante pode criar conversas e leads.
- **Escritas do painel abertas a qualquer visitante:** com o acesso de demonstração, assumir e encerrar leads ficam ao alcance de qualquer um. Visitantes simultâneos veem e alteram os mesmos dados. Como não há registro de autoria (backlog, seção 6b), não dá para saber quem fez cada ação.
- **Sem limite de tentativas de login:** já listado no [backlog técnico](33-backlog-tecnico.md), seção 6a. Num deploy público, cada login custa uma derivação scrypt de cerca de 128 MiB, o que também é um vetor de consumo de memória.
- **Sessões derrubadas pelo seed:** rodar o seed de novo encerra as sessões do atendente de demonstração, inclusive as de outros visitantes.
- **Sem deploy nesta entrega:** o servidor continua escutando só em `127.0.0.1`. Expor fora do loopback exige HTTPS e `SESSION_COOKIE_SECURE=true` (D23).

## O que fica para depois

- **Reset dos dados de demonstração:** um comando que apague conversas, mensagens, leads e jobs sintéticos e mantenha os atendentes.
- **Deploy:** hospedagem com HTTPS, `SESSION_COOKIE_SECURE=true`, `DEMO_PASSWORD` igual à do README e o seed rodando no ambiente do deploy.
- **Reset periódico:** agendar o reset dos dados (e, se fizer sentido, o seed) para que cada visitante encontre o painel num estado conhecido.
