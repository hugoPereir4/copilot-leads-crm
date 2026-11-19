# Login de atendentes

Branch `feat/login-atendentes`, baseada em `docs/backlog-tecnico` (`1f5cc98`). Uma migração nova, sem dependência nova, sem merge na `main`. A decisão de arquitetura está na [D23](02-decisoes-de-arquitetura.md#d23-autenticação-de-atendentes-por-sessão-no-servidor).

## Entrega e regras

Atende o RF13 ([docs/01](01-escopo-e-requisitos.md)): o painel passa a exigir login e senha de atendente.

- **Protegidos:** `/admin`, `/simulator` e todas as rotas `/api/demo/*`.
- **Abertos:**
  - o webhook `POST /webhooks/simulator`, que continua igual;
  - os arquivos em `/assets/*`;
  - a página `/login` e as rotas `/api/auth/*`.
- **Atendentes:** criados só pela linha de comando (`attendant:create`). Não há cadastro pela interface, papéis nem desativação.
- **Sessão no servidor:** cookie `copilot_session` com um token aleatório. O banco guarda só o SHA-256 do token. Não há JWT.
- **Validade:** `SESSION_TTL_HOURS` (1 a 24, padrão 12), contada a partir do login, sem renovação automática.
- **Troca de senha** (`attendant:set-password`): apaga todas as sessões do atendente na mesma transação.
- **Sem registro de autoria:** o atendente fica disponível em `response.locals.attendant`, mas nenhum caso de uso o recebe. Assumir e encerrar ainda não registram quem fez a ação.
- **Fora desta entrega:** limite de tentativas de login, registro de autoria e HTTPS. Estão no [backlog técnico](33-backlog-tecnico.md), seção 6.

| Situação | Resultado |
|---|---|
| Página protegida sem sessão | `303` para `/login?next=<rota>` |
| `/login` com sessão válida | `303` para o `next` permitido, ou `/admin` |
| Rota `/api/demo/*` sem sessão, sessão expirada ou token alterado | `401 unauthenticated` |
| `next` diferente de `/admin` e `/simulator` | Tratado como `/admin` (sem redirecionamento aberto) |
| `POST`/`PUT`/`PATCH`/`DELETE` sob `/api` com `Origin` diferente de `http://` + `Host` | `403 forbidden_origin` |
| Mesma requisição sem `Origin` | Passa (curl, Postman, testes) |

No navegador, qualquer `401` no painel interrompe o polling e leva ao login com a rota atual em `next`. O cabeçalho mostra o nome do atendente e o botão **Sair**.

## Modelo de dados

Migração `apps/api/migrations/1795046400000_create_attendants.sql`. Não altera tabelas existentes.

| Tabela | Coluna | Regras |
|---|---|---|
| `attendants` | `id` | `uuid`, PK, `gen_random_uuid()` |
| | `username` | Único; `CHECK` `^[a-z0-9._-]{3,32}$` (só minúsculas) |
| | `display_name` | `CHECK` de 1 a 80 caracteres após `btrim` |
| | `password_hash` | Texto no formato `scrypt$17$8$1$<salt>$<hash>` |
| | `created_at`, `updated_at` | `timestamptz`, padrão `now()` |
| `attendant_sessions` | `token_hash` | `bytea`, PK, `CHECK` de 32 bytes (SHA-256) |
| | `attendant_id` | FK para `attendants`, `ON DELETE CASCADE`, com índice |
| | `created_at`, `expires_at` | `CHECK expires_at > created_at` |

O `created_at` da sessão é gravado com o relógio da aplicação, o mesmo que calcula `expires_at`. Assim o `CHECK` também vale nos testes com relógio injetado. As sessões expiradas são apagadas a cada login bem-sucedido. O `down` remove as duas tabelas, sessões primeiro. O `start:demo` confere as duas tabelas antes de consumir jobs.

## Contrato HTTP

Todas as respostas de `/api/auth/*` têm `Cache-Control: no-store`. Os erros seguem o formato atual: `code`, `message` e `correlationId`, igual ao header `X-Correlation-ID`.

`POST /api/auth/login`: `Content-Type: application/json`, limite de 64 KiB, body estrito `{ "username": string, "password": string }`. O usuário é normalizado (trim e minúsculas) antes da busca.

| HTTP | Resultado |
|---|---|
| 200 | `{ id, username, displayName }` e `Set-Cookie` da sessão |
| 400 | `invalid_payload` (campo ausente, extra ou com tipo errado) ou `invalid_json` (JSON malformado ou primitivo) |
| 401 | `invalid_credentials`, igual para usuário inexistente, senha errada ou formato fora da regra |
| 403 | `forbidden_origin` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 500 | `auth_login_failed` |

`GET /api/auth/me`: com sessão, `200 { id, username, displayName }`; sem sessão, `401 unauthenticated`.

`POST /api/auth/logout`: sempre `204`, sem body. Apaga a sessão do cookie, se existir, e limpa o cookie. É idempotente e não exige sessão válida. Só é recusado com `403` quando o `Origin` é diferente.

Rotas existentes de `/api/demo/*` (listar conversas, histórico, assumir, encerrar): mesmo contrato dos docs [30](30-assuncao-de-atendimento-humano.md) e [31](31-encerramento-de-leads.md). Agora exigem o cookie de sessão; sem ele, respondem `401 unauthenticated`.

Páginas: `GET /login` (aberta), `GET /admin` e `GET /simulator` (303 sem sessão), `GET /` (redireciona para `/simulator`). As páginas também respondem com `Cache-Control: no-store`.

Logs JSON:
- `auth_login_succeeded`, com `attendantId` e `correlationId`;
- `auth_login_failed`, só com `correlationId` e um motivo genérico (`invalid_payload`, `invalid_credentials` ou `internal_error`);
- `auth_logout_failed`.

Nunca registram usuário, senha, hash ou token.

## Cookie, Origin e hash: por quê

- **Cookie `copilot_session`:** `HttpOnly; SameSite=Lax; Path=/; Max-Age=<TTL em segundos>`, mais `Secure` quando `SESSION_COOKIE_SECURE=true`. O logout devolve o mesmo cookie vazio com `Max-Age=0`.
  - `HttpOnly` impede que um script da página leia o token.
  - `SameSite=Lax` impede que outro site envie o cookie em requisições `POST`.
  - `Secure` fica desligado por padrão porque o servidor só fala HTTP em `127.0.0.1`. Qualquer exposição fora do loopback exige HTTPS e `SESSION_COOKIE_SECURE=true`.
- **Token:** `randomBytes(32)` em base64url (43 caracteres). O banco guarda só o SHA-256: quem lê o banco não consegue usar uma sessão. Token malformado nem chega à consulta.
- **Checagem de Origin (CSRF):** o navegador envia `Origin` em requisições que alteram estado. Se ele não for a própria API, a requisição é recusada antes das rotas. Clientes sem `Origin` (curl, Postman) passam; para eles não há cookie de terceiros a explorar. Um cliente sem `Origin` confiável exigiria token sincronizador (backlog, seção 6).
- **Hash da senha:** scrypt do `node:crypto`, sem dependência nova.
  - Parâmetros: N = 2^17, r = 8, p = 1, `maxmem` de 256 MiB, salt de 16 bytes, chave de 32 bytes e comparação com `timingSafeEqual`.
  - Custo: cada derivação usa cerca de 128 MiB de memória, o que encarece ataques com GPU.
  - Em `verify`, qualquer formato ou parâmetro diferente devolve `false`, sem exceção.
  - Usuário inexistente roda `verify` contra um hash fictício, gerado uma vez sob demanda. A resposta e o custo ficam iguais aos de senha errada.
- **Login tolerante ao formato:** o login não devolve `400` para usuário fora do formato nem para senha fora de 12 a 128 caracteres. Esses casos também recebem `401 invalid_credentials`, para não distinguir as falhas. O `400` fica só para corpo estruturalmente inválido.

## Ordem de revisão dos arquivos

1. **Migração:** `apps/api/migrations/1795046400000_create_attendants.sql` e a verificação de inicialização em `apps/api/src/demo.ts`.
2. **Configuração:** `apps/api/src/config/auth.ts` e `.env.example`.
3. **Contratos e portas:** `apps/api/src/modules/auth/contracts/attendant.ts` e `apps/api/src/modules/auth/application/ports.ts`.
4. **Casos de uso:** `apps/api/src/modules/auth/application/attendant-auth.ts` (login, authenticate, logout) e `apps/api/src/modules/auth/application/manage-attendants.ts` (createAttendant, setAttendantPassword).
5. **Infraestrutura:**
   - `apps/api/src/modules/auth/infrastructure/scrypt-password-hasher.ts`;
   - `apps/api/src/modules/auth/infrastructure/session-tokens.ts`;
   - `apps/api/src/modules/auth/infrastructure/postgres-attendant-store.ts`;
   - `apps/api/src/modules/auth/infrastructure/postgres-session-store.ts`.
6. **HTTP:** `apps/api/src/modules/auth/http/cookies.ts`, `origin-guard.ts`, `require-session.ts` e `auth-routes.ts`.
7. **Composição:** `apps/api/src/http/panel.ts`, usada pelo `demo.ts` e pelas suítes de integração. `apps/api/src/http/demo-routes.ts` passou a ter só as rotas JSON. `start:api` (`apps/api/src/index.ts`) não mudou.
8. **CLI:** `apps/api/src/scripts/attendant-admin.ts` (lógica) e `apps/api/src/scripts/attendant-cli.ts` (terminal sem eco). Scripts em `package.json` e `apps/api/package.json`.
9. **Contrato público:** `packages/shared/src/auth.ts`, exportado no `index.ts`.
10. **Frontend:**
    - `apps/web/login.html`, `apps/web/src/login.ts` e `apps/web/src/styles/login.css`;
    - `apps/web/src/demo.ts`, `apps/web/index.html` e `apps/web/src/styles/components.css`.
11. **Testes:** os unitários de cada camada e as suítes de integração descritas abaixo.

## Verificações automatizadas

Na raiz, com o PostgreSQL do container em execução:

```powershell
npm run check
npm run test:integration
```

**Testes unitários (em `check`):**

| Arquivo | O que cobre |
|---|---|
| `config/auth.test.ts` | Configuração |
| `auth/infrastructure/scrypt-password-hasher.test.ts` | Hasher e token: formato, salts diferentes, parâmetros estranhos devolvem `false` |
| `auth/application/attendant-auth.test.ts` | Validação; casos de uso com fakes: mesmo resultado para usuário inexistente e senha errada, hash fictício gerado uma vez, expiração com relógio injetado, logout |
| `auth/http/auth-http.test.ts` | Parser de cookie, atributos do cookie, guarda de Origin e lista de `next` |
| `scripts/attendant-admin.test.ts` | CLI com leitor de senha fake: senhas diferentes, tamanho inválido, usuário duplicado, argumentos |

**Integração, cada suíte em banco descartável próprio:**

| Suíte | O que cobre |
|---|---|
| `infrastructure/database/attendants-migration.integration.test.ts` | Up/down, unicidade, CHECKs, FK e cascade |
| `http/panel-auth.integration.test.ts` | Login certo e atributos do `Set-Cookie`; 401 igual para senha errada e usuário inexistente; 401 sem cookie e com token alterado nas quatro rotas de `/api/demo` e em `/me`; 303 das páginas e `next` permitido; `/login` com sessão; logout; `set-password` apagando as sessões; sessão expirada; Origin; webhook aberto |
| `infrastructure/simulator/simulator-flow.integration.test.ts` | Cria um atendente com hasher de custo baixo, faz login uma vez e reaproveita o cookie. No teste do processo real (`demo.js` como processo filho), o atendente é gravado com o hasher de produção e o login é feito por HTTP |

**Web:** `apps/web/scripts/demo-ui.test.js` cobre o 401 que leva ao login e para o polling, além do botão Sair. `apps/web/scripts/login-ui.test.js` cobre sucesso, 401 e botão desabilitado durante o envio.

Nenhum teste desliga a autenticação: todos fazem login de verdade.

**Resultado desta entrega:**

| Verificação | Resultado |
|---|---|
| `npm run check` | Aprovado com **194 testes da API e 12 da web** (antes: 174 + 7) |
| `npm run test:integration` | Aprovado com **228 registros** (antes: 211) |

Tempo da suíte de fluxo rodando sozinha, alternando com a base `1f5cc98` na mesma máquina:

| Versão | 1ª execução | 2ª execução |
|---|---|---|
| Base `1f5cc98` | 15,4 s | 15,7 s |
| Com login | 18,3 s | 16,1 s |

Na execução completa, em paralelo com as demais suítes, a suíte de fluxo levou 37,8 s, contra o limite de 60 s (item 3a do backlog). O acréscimo vem sobretudo do hash e da verificação com os parâmetros de produção no teste do processo real.

## Teste manual no navegador

1. Inicie o PostgreSQL, se necessário: `docker compose up -d --wait --wait-timeout 120 postgres`.
2. Revise e aplique a migração nova: `npm run db:migrate`. Ela cria `attendants` e `attendant_sessions` e não altera as demais tabelas.
3. Crie um atendente: `npm run attendant:create -- hugo "Hugo"`. Digite e confirme uma senha de 12 a 128 caracteres; cada tecla aparece como um asterisco; Backspace apaga o último. A saída mostra só `id` e `username`.
4. Inicie a demonstração: `npm run start:demo`.
5. Abra `http://127.0.0.1:3000/admin` (ou a porta de `API_PORT`). O navegador deve ir para `/login?next=%2Fadmin`.
6. Tente uma senha errada: a mensagem é "Usuário ou senha inválidos." e o campo de senha fica vazio. Depois, entre com a senha certa: o painel abre e o cabeçalho mostra "Hugo".
7. Em `/simulator`, envie "Olá", aguarde o menu e envie "3". No `/admin`, o card Novo aparece, e **Assumir atendimento** e **Ganho/Perdido** funcionam como antes.
8. Clique **Sair**: o navegador volta a `/login`. Abrir `/admin` de novo leva ao login.
9. Entre de novo e deixe o painel aberto. Em outro terminal, rode `npm run attendant:set-password -- hugo` e defina uma nova senha. Em até um segundo, o painel detecta o `401` do polling e volta ao login. A senha antiga deixa de funcionar e a nova entra.

**Nota:** o cookie de sessão é guardado por perfil do navegador. Para testar dois atendentes ao mesmo tempo, use perfis separados, ou uma janela normal e uma anônima. Janelas anônimas abertas ao mesmo tempo no mesmo navegador compartilham os cookies entre si.

Para a API, o teste manual será feito por uma coleção Postman preparada à parte.
