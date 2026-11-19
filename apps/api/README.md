# Backend

## Papel da API

O backend é um monólito modular (D1): um único processo Node.js com Express, dividido em módulos com fronteiras próprias. Cada módulo separa contratos, casos de uso (`application`), adapters de infraestrutura e rotas HTTP (D2). Ele:

- recebe as mensagens do simulador por webhook e as grava numa transação, com o job de processamento (D3, D5);
- mantém uma fila de jobs em tabela do PostgreSQL, com reserva, novas tentativas e recuperação de reservas expiradas (D4);
- roda o worker do simulador, que decide a resposta pelo estado da conversa, monta os textos predefinidos e grava as respostas e o novo estado;
- qualifica o texto livre com um qualificador simulado ou, se configurado, com o Gemini (D8);
- serve o painel, o simulador e a tela de login, com as rotas de leitura, assunção e encerramento;
- autentica atendentes por sessão no servidor (D23).

A API depende só dos tipos públicos de `@copilot-leads/shared`; o pacote compartilhado não depende dela.

## Estrutura

Em `src/modules/`:

| Módulo | Responsabilidade |
|---|---|
| `messaging` | Webhook e adapter do simulador, mensagem normalizada, recepção transacional, contexto da mensagem, decisão por estado, composição dos textos e plano de resposta |
| `jobs` | Fila em tabela: reserva com `FOR UPDATE SKIP LOCKED`, conclusão, falha com nova tentativa e recuperação de reservas expiradas |
| `business-profile` | Perfil da clínica fictícia em `config/business-profile.json`, schema Zod e cálculo de expediente |
| `simulator` | `SimulatorProcessor` (o worker) e as portas de efeitos e de leitura do painel |
| `leads` | Lead de recepção, qualificação (simulada ou Gemini), assunção e encerramento, com as rotas `/api/demo/leads/:id/assume` e `/close` |
| `auth` | Atendentes, login, sessão no servidor, hash scrypt, cookie, checagem de `Origin` e guarda de sessão |

Fora dos módulos:

| Pasta | Conteúdo |
|---|---|
| `src/config/` | Leitura e validação das variáveis de ambiente com Zod (`database`, `http`, `auth`, `qualification`) |
| `src/http/` | `app.ts` (webhook, erros padronizados e `X-Correlation-ID`), `panel.ts` (páginas, login e rotas `/api/demo/*`), `demo-routes.ts`, `login-page.ts` e `listen-http.ts` |
| `src/infrastructure/database/` | Pool `pg` e testes de integração das migrações |
| `src/infrastructure/simulator/` | Transação dos efeitos do worker (`postgres-simulator-effects.ts`) e leitura do painel (`postgres-demo-read-model.ts`) |
| `src/scripts/` | Comandos de linha: banco, atendentes, simulador e diagnóstico do Gemini |
| `migrations/` | As oito migrações SQL, aplicadas com `node-pg-migrate` |
| `config/` | `business-profile.json`, o perfil de demonstração |
| `examples/simulator/` | `text-message.json`, usado por `simulate:message` |

## Pontos de entrada

| Arquivo | O que inicia |
|---|---|
| `src/index.ts` (`start`) | Só a API HTTP com o webhook `POST /webhooks/simulator`, em `127.0.0.1`. Sem worker, sem telas e sem login |
| `src/demo.ts` (`start:demo`) | API, painel (`/admin`), simulador (`/simulator`), login (`/login`), rotas `/api/demo/*` e o worker do simulador, que também recupera reservas expiradas a cada 30 s. Confere antes se as tabelas de leads, qualificação e atendentes existem |
| `src/scripts/check-database.ts` (`db:check`) | Consulta o banco e o usuário pela conexão da aplicação |
| `src/scripts/migrate-database.ts` (`db:migrate`) | Aplica as migrações pendentes; o histórico fica em `public.pgmigrations` |
| `src/scripts/attendant-cli.ts` (`attendant:create`, `attendant:set-password`) | Cria um atendente ou troca a senha; a senha é lida no terminal, com um asterisco por tecla |
| `src/scripts/attendant-seed-demo-cli.ts` (`attendant:seed-demo`) | Cria ou atualiza o atendente de demonstração a partir de `DEMO_USERNAME` e `DEMO_PASSWORD`, sem perguntar nada |
| `src/scripts/simulate-message.ts` (`simulate:message`) | Envia `examples/simulator/text-message.json` ao webhook local |
| `src/scripts/diagnose-gemini-cli.ts` | Diagnóstico manual do Gemini, com chamadas reais e confirmação digitada (`EXECUTAR`). Só existe como `npm run diagnose:gemini` na raiz ([documento 32](../../docs/32-qualificacao-de-leads.md)) |

## Configuração

Variáveis lidas pelo código em `src/config/`. Os valores de exemplo estão no `.env.example` da raiz, carregado pelos scripts com `--env-file`.

| Variável | Padrão | Limites e regras | Lida por |
|---|---|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | — | Obrigatórias, não vazias | API, demo e scripts de banco e atendentes |
| `POSTGRES_HOST` | `127.0.0.1` | Texto não vazio | Idem |
| `POSTGRES_PORT` | `5432` | 1 a 65535 | Idem |
| `API_PORT` | `3000` | 1 a 65535 | API, demo e `simulate:message` |
| `SESSION_TTL_HOURS` | `12` | Inteiro de 1 a 24 | Demo |
| `SESSION_COOKIE_SECURE` | `false` | `true` ou `false` | Demo |
| `QUALIFIER_PROVIDER` | `simulated` | `simulated` ou `gemini` | Demo e diagnóstico |
| `GEMINI_API_KEY` | — | Obrigatória com `gemini` | Demo e diagnóstico |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Só esse valor é aceito | Demo e diagnóstico |
| `QUALIFIER_TIMEOUT_MS` | `25000` | 100 a 30000; com `gemini`, mínimo 10000 | Demo e diagnóstico |
| `QUALIFIER_MAX_CONTEXT_CHARS` | `8000` | 1000 a 20000 | Demo e diagnóstico |
| `QUALIFIER_MAX_OUTPUT_CHARS` | `4000` | 500 a 12000; limita o texto bruto da resposta do Gemini | Demo e diagnóstico |
| `DEMO_USERNAME`, `DEMO_PASSWORD` | — | Opcionais, as duas juntas ou nenhuma (vazio conta como ausente); usuário em `^[a-z0-9._-]{3,32}$`, senha de 12 a 128 caracteres | Demo e `attendant:seed-demo` |

Mensagens de erro de configuração citam só os nomes das variáveis, nunca os valores.

## Scripts

Scripts de `apps/api/package.json`. Eles esperam a API já compilada em `dist/`; os scripts da raiz, descritos no [README principal](../../README.md), compilam antes de chamar estes.

| Script | Finalidade |
|---|---|
| `build` | Compila com `tsc` para `dist/` |
| `typecheck` | Verifica os tipos sem emitir arquivos |
| `start` | Executa `dist/index.js`: só a API com o webhook |
| `start:demo` | Executa `dist/demo.js`: API, telas e worker |
| `simulate:message` | Envia o exemplo versionado ao webhook local |
| `test` | Testes sem banco |
| `test:integration` | Testes com PostgreSQL em bancos descartáveis |
| `db:check` | Testa a conexão com o banco do `.env` |
| `db:migrate` | Aplica as migrações pendentes no banco do `.env` |
| `attendant:create` | Cria um atendente: `attendant:create -- <usuario> "<nome>"` |
| `attendant:set-password` | Troca a senha e encerra as sessões: `attendant:set-password -- <usuario>` |
| `attendant:seed-demo` | Cria ou atualiza o atendente de demonstração |

## Testes

- **`test`:** 33 arquivos com `node --test`. Cobrem configuração, contratos, casos de uso, adapters, HTTP (em porta aleatória), CLI de atendentes e leitura de senha. Não abrem banco nem precisam de `.env`. Também rodam no `npm run check` da raiz.
- **`test:integration`:** 15 arquivos. Cobrem as migrações, a recepção, a fila de jobs, o contexto, o plano de resposta, o fluxo completo do simulador e o login no painel.
  - **Requisitos:** um PostgreSQL local (`127.0.0.1`, `localhost` ou `::1`) em execução, como o do `compose.yaml`, e o `.env` da raiz para a conexão.
  - **Isolamento:** cada suíte cria o próprio banco descartável, aplica as migrações nele e o apaga no fim. Nenhuma escreve no banco do projeto.

## Documentação

- [Documentação do projeto](../../docs/), com as decisões D1 a D23 no [documento 2](../../docs/02-decisoes-de-arquitetura.md).
- [Histórico de etapas](../../docs/36-historico-de-etapas.md), que inclui o histórico da API até a etapa 4.20, antes mantido neste arquivo.
