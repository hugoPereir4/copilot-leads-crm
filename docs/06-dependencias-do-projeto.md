# Copiloto de Leads WhatsApp — 6. Dependências do Projeto

Documento de planejamento · rascunho de 23/10/2026

Inventário de tudo de que o projeto depende: ambiente, bibliotecas, ferramentas de desenvolvimento, serviços externos e infraestrutura. Cada item diz **para que serve** e, quando há mais de uma opção, **qual é a alternativa**, para você decidir com consciência.

## Como ler este documento

- **Versões não estão fixadas de propósito.** Versões mudam rápido e não devem ser copiadas de um documento. Ao instalar, use a versão estável mais recente (`npm view <pacote> version` mostra qual é) e deixe o arquivo de lock registrar o que foi instalado.
- **Marcações:** **Núcleo** = o projeto não funciona sem; **Recomendado** = melhora muito, mas dá para trocar; **Opcional** = só se sobrar tempo.
- **A decidir** indica uma escolha que ainda é sua (veja a seção 11).
- Os nomes de pacotes refletem o ecossistema no momento da escrita. Confirme na página do pacote que ele continua mantido antes de adotá-lo.

## 1. Ambiente de desenvolvimento

| Item | Para que serve | Classificação | Observação |
|---|---|---|---|
| Node.js | Executar o backend e as ferramentas | Núcleo | Base da etapa 3 validada com Node `24.14.1`, já instalado; versão de referência em `.nvmrc` e intervalo aceito em `engines`. |
| **npm** | Instalar dependências e gerenciar o monorepo com workspaces | Núcleo, confirmado na D19 | Usar `package.json` e `package-lock.json` na raiz, com as dependências de cada pacote declaradas no respectivo `package.json`. |
| TypeScript | Tipagem estática | Núcleo | `7.0.2` instalado na etapa 3; modo `strict` e configurações por ambiente. Consulte o documento 8. |
| Git e GitHub | Versionamento e portfólio | Núcleo | Uma branch por entrega pequena, Conventional Commits e `main` revisada e funcionando; fluxo confirmado no documento 7. O repositório público é parte do portfólio. |
| Docker e Docker Compose | Executar o banco localmente a partir de configuração versionada | Núcleo, confirmado na D10 | Primeira entrega: somente PostgreSQL em container, com volume nomeado. A aplicação em containers fica para depois. |
| PostgreSQL | Banco de dados relacional | Núcleo, confirmado na D10 | Sustenta transações, unicidade e fila de jobs; no desenvolvimento local, será executado com Docker Compose. |
| Editor (VS Code) | Desenvolvimento | Recomendado | Extensões: ESLint, Prettier, Mermaid Preview. |

## 2. Backend: dependências de execução

| Biblioteca | Para que serve | Classificação | Alternativas / observação |
|---|---|---|---|
| Framework HTTP: **Express** | Rotas e middlewares do webhook e da API do painel | Núcleo, confirmado na D20 | Escolhido para acompanhar as aulas da faculdade. Validação e tratamento de erros serão configurados explicitamente; regras de negócio permanecem nos casos de uso. |
| **Zod** | Validação em execução e tipos derivados dos contratos | Núcleo, confirmado na D21 | `4.6.7` instalado na API na etapa 4.2 para validar a configuração do banco. Schemas compartilhados de API e eventos entrarão em `packages/shared` quando necessários; configuração do servidor permanece no backend. |
| Driver **pg** (node-postgres) | Conectar ao PostgreSQL e executar SQL parametrizado | Núcleo, confirmado na D22 | `8.23.1` instalado no workspace da API na etapa 4.2; tipos com `@types/pg` `8.23.1` em desenvolvimento. |
| Camada de acesso a dados | Repositórios com SQL explícito | Núcleo, confirmado na D22 | Usar `pg` diretamente; Kysely, Drizzle e Prisma foram considerados. Os tipos dos resultados são mantidos pelo projeto, sem inferência a partir do SQL. |
| **node-pg-migrate** | Versionar e aplicar alterações na estrutura do banco | Núcleo, confirmado na D22 | `9.0.0` instalado como dependência de desenvolvimento da API. Migrações SQL ficam em `apps/api/migrations`; o documento 10 explica a execução. |
| **pino** | Logs estruturados com correlation id | Recomendado | Integração com o backend Express a definir na entrega de observabilidade. |
| Hash de senha: **argon2** | Guardar senhas dos atendentes | Núcleo | Alternativa: bcrypt. Nunca armazenar senha em texto. |
| Sessão / autenticação | Login do painel | Núcleo (a decidir) | Cookie de sessão `httpOnly` ou JWT (biblioteca **jose**). Para um painel único, cookie de sessão é mais simples e seguro. |
| Middlewares de segurança (CORS, cabeçalhos, rate limit) | Proteger a API e o endpoint do webhook | Recomendado | Opções para Express: `cors`, `helmet`, `express-rate-limit`; adoção e configuração nas entregas pertinentes. |
| Leitura de variáveis de ambiente | Carregar configuração | Núcleo | Node já aceita `--env-file`; ou **dotenv**. Valide as variáveis com Zod ao iniciar. |
| **libphonenumber-js** | Normalizar telefones para formato internacional | Recomendado | Evita duplicar contatos por formatos diferentes de um mesmo número. |
| SDK do provedor de IA | Chamar o LLM | Núcleo | Veja a seção 5. Esconda atrás de uma interface própria, como no adapter do WhatsApp. |
| p-retry (ou lógica própria) | Novas tentativas com intervalo crescente | Opcional | Também dá para escrever à mão; é um bom exercício. |

**O que não precisa de biblioteca:** requisições HTTP (o `fetch` nativo do Node basta), geração de UUID (`crypto.randomUUID`), SSE (é só HTTP com um cabeçalho específico) e o worker de jobs (um laço com consulta ao banco).

## 3. Frontend (painel Kanban)

| Biblioteca | Para que serve | Classificação | Alternativas / observação |
|---|---|---|---|
| **React** | Interface | Núcleo | |
| **Vite** | Servidor de desenvolvimento e build | Núcleo | |
| **TypeScript** | Tipagem | Núcleo | Mesma configuração base do backend. |
| **React Router** | Navegação (login, painel, detalhe) | Recomendado | |
| **TanStack Query** | Cache e sincronização de dados do servidor | Recomendado | Combina bem com os eventos SSE: o evento invalida o cache e a lista é recarregada. |
| **dnd-kit** | Arrastar e soltar cards entre colunas | Núcleo para o Kanban | Alternativa: `@hello-pangea/dnd`. |
| **Tailwind CSS** | Estilização | Recomendado | Alternativas: CSS Modules, uma biblioteca de componentes. |
| shadcn/ui ou similar | Componentes prontos (botões, modais, formulários) | Opcional | Acelera a interface, mas adiciona conceitos extras. |
| react-hook-form | Formulário de login e filtros | Opcional | |
| Zod | Validar respostas da API no cliente | Recomendado | Reaproveita os schemas do pacote compartilhado. |
| lucide-react | Ícones | Opcional | |

**Sem biblioteca:** `EventSource` (SSE) já vem no navegador, e formatação de datas pode usar `Intl`.

## 4. Pacote compartilhado e estrutura do repositório

| Item | Para que serve | Observação |
|---|---|---|
| **npm workspaces** | Monorepo com `apps/api`, `apps/web` e `packages/shared` | Monorepo e gerenciador confirmados na D19; workspaces definidos no `package.json` da raiz. |
| `packages/shared` | Schemas Zod e tipos de DTOs, eventos SSE e erros | Fonte única dos contratos, confirmada na D19; Zod confirmado na D21. |
| `tsconfig` base | Configuração estrita comum | Cada app estende o arquivo base. |
| Turborepo / Nx | Orquestração de tarefas | **Opcional e provavelmente desnecessário** para dois apps e um pacote. |

## 5. Serviços externos

### 5.1 Provedor de WhatsApp (simulador confirmado; provedor real a decidir)

**Decisão D14:** o desenvolvimento e a demonstração inicial usam o simulador próprio, incluindo o registro simulado dos envios automáticos. Conta, credenciais, número real e túnel público de WhatsApp só serão necessários na etapa posterior de integração real. A escolha da API de IA permanece separada.

| Opção | Tipo | Quando faz sentido | Cuidados |
|---|---|---|---|
| **Simulador próprio** | Código seu | Desenvolvimento, testes e demonstração (**v1**) | Nenhum custo ou risco. |
| **Evolution API** | Não oficial, self-hosted | Demonstração com número real | Pode causar banimento do número. Veja na documentação oficial os requisitos de infraestrutura. |
| **Baileys** | Biblioteca não oficial | Mesmo caso, com mais código seu | Mesmo risco de banimento. |
| **Z-API** | Serviço pago, não oficial | Demonstração sem hospedar nada | Custo mensal; verifique os termos atuais. |
| **WhatsApp Cloud API (Meta)** | Oficial | Uso real em produção | Exige conta Meta Business e passos de verificação; as regras de mensagens iniciadas pela empresa têm custo e modelos aprovados. Confira a documentação atual. |

Independentemente da escolha, use um **chip dedicado** nos testes com número real, nunca o seu pessoal.

### 5.2 API de IA (a decidir)

Requisitos mínimos para o seu uso: saída estruturada com JSON Schema (ou JSON confiável), controle de tempo limite, custo previsível e SDK oficial para Node.

| Opção | Observação |
|---|---|
| API da Anthropic (Claude) | Verifique a documentação atual sobre saídas estruturadas. |
| API da OpenAI | Idem. |
| API do Google (Gemini) | Idem. |

Pontos práticos:

- É necessária uma **chave de API** e, em geral, um cartão para faturamento. Defina um **limite de gasto** no painel do provedor desde o início.
- Os modelos e preços mudam com frequência: confirme na página do provedor na hora de escolher.
- Esconda o provedor atrás de uma interface própria (por exemplo, um "qualificador"). Assim você troca de provedor, ou usa um falso nos testes, sem tocar no resto do código.

### 5.3 Transcrição de áudio (v1.1, fora da v1)

Uma API de transcrição de fala para texto (os mesmos provedores de IA costumam oferecer). Só entra quando o áudio entrar no escopo.

### 5.4 Túnel público para webhooks

Só é necessário ao usar um provedor real em desenvolvimento, porque o provedor precisa alcançar seu computador. Opções: **ngrok**, **Cloudflare Tunnel** ou **localtunnel**. Com o simulador, não precisa.

### 5.5 APIs públicas

**Nenhuma API pública adicional é necessária na v1.** Na demonstração inicial, a integração de WhatsApp é simulada; a API de IA é uma dependência separada. Um provedor real de WhatsApp só entra na etapa posterior (D14). Se você pensar em enriquecer os leads (por exemplo, validar endereço), isso seria uma extensão futura.

## 6. Dependências de desenvolvimento

| Ferramenta | Para que serve | Classificação |
|---|---|---|
| **tsx** | Executar TypeScript direto em desenvolvimento, com recarga | Recomendado |
| `@types/node` e tipos dos pacotes sem tipagem própria | Tipos para o compilador | Núcleo; `@types/node@24.19.2` instalado na etapa 3 |
| **ESLint** + typescript-eslint | Regras de qualidade e proibição de `any` nas fronteiras | Núcleo |
| **Prettier** | Formatação | Recomendado (ou Biome, que une lint e formatação) |
| **Vitest** | Testes unitários e de integração, nos dois lados | Núcleo |
| **Supertest** | Testar as rotas HTTP da aplicação Express sem manter um servidor separado | Recomendado |
| **Testcontainers** | PostgreSQL real e descartável nos testes de integração | Recomendado |
| React Testing Library + jsdom | Testar componentes | Recomendado |
| **Playwright** | Teste ponta a ponta do fluxo completo | Opcional |
| Husky + lint-staged | Rodar lint e formatação antes de cada commit | Opcional |
| Compilador de build (`tsc` ou **tsup**) | Gerar o JavaScript final do backend | Núcleo |

Testes que valem priorizar (do documento 1): idempotência, máquina de estados e validação da saída da IA.

## 7. Ferramentas de apoio (fora do repositório)

| Ferramenta | Uso |
|---|---|
| mermaid.live | Visualizar o fluxograma |
| dbdiagram.io | Visualizar o modelo de dados |
| Bruno, Insomnia, Postman ou HTTPie | Testar a API e disparar webhooks à mão |
| DBeaver, pgAdmin ou TablePlus | Inspecionar o banco |
| Codex | Geração de código a partir dos documentos de planejamento |

## 8. Infraestrutura e entrega

| Item | Para que serve | Observação |
|---|---|---|
| Docker Compose | Subir banco, API e painel juntos com um comando | Excelente para o README do portfólio. |
| GitHub Actions | Integração contínua: lint, tipos e testes a cada push | Núcleo para demonstrar maturidade. |
| Dependabot ou Renovate | Atualização automática de dependências | Recomendado. |
| Hospedagem da API e do worker | Demonstração online | Opções comuns: Render, Railway, Fly.io. **Planos gratuitos mudam**: confira as condições atuais. |
| Banco gerenciado | PostgreSQL hospedado | Neon, Supabase e similares. Confira limites atuais. |
| Hospedagem do painel | Frontend estático | Vercel, Netlify, Cloudflare Pages. |

Para uma demonstração em vídeo, o `docker compose up` local com o simulador pode ser suficiente e não custa nada.

## 9. Segredos e variáveis de ambiente

Nunca versionar o arquivo `.env`. Versione apenas o `.env.example`, sem valores reais.

| Variável | Uso |
|---|---|
| DATABASE_URL | Conexão com o PostgreSQL |
| PORT | Porta da API |
| SESSION_SECRET (ou JWT_SECRET) | Assinatura de sessão |
| WEBHOOK_SECRET | Verificar que o webhook vem do provedor (se ele oferecer esse recurso) |
| WHATSAPP_PROVIDER | Qual adapter usar (simulador, evolution etc.) |
| Variáveis do provedor escolhido | URL base, chave e nome da instância |
| LLM_API_KEY | Chave da API de IA |
| LLM_MODEL | Modelo usado, mantido fora do código |
| LLM_TIMEOUT_MS | Tempo máximo de espera da IA |
| CONFIDENCE_THRESHOLD | Limiar de confiança para acionar a revisão |
| BUSINESS_PROFILE_PATH | Caminho da configuração do negócio, se for arquivo |

Valide as variáveis com Zod na inicialização, exigindo apenas as aplicáveis ao modo e aos provedores selecionados. O simulador não exige credenciais de um provedor real de WhatsApp. Se faltar uma variável obrigatória para o modo escolhido, o sistema nem sobe, e o erro é claro.

## 10. Ordem sugerida de instalação por fase

**Acompanhamento de Docker:** o autor ainda não utilizou a ferramenta. Antes de iniciar uma etapa que a utilize, avisar, explicar o que será feito e indicar a documentação oficial pertinente, permitindo que ele acompanhe o aprendizado e revise uma entrega por vez. A D10 contém as referências iniciais.

| Fase | O que instalar |
|---|---|
| 0. Base do monorepo (etapa 3) | npm workspaces, TypeScript e tipos de Node; configuração para Node e npm já instalados. Entrega e versões no documento 8. |
| Preparação das entregas seguintes | Docker antes da persistência, com aviso ao autor; lint, formatação e ferramentas de teste conforme as entregas e decisões pendentes. |
| 1. Webhook e persistência | Express, Zod, pg, camada de dados e migrações, pino, simulador |
| 2. Fila e worker | Nada novo; usa o banco e a lógica própria |
| 3. IA | SDK do provedor, regras de timeout e novas tentativas |
| 4. Painel | React, Vite, React Router, TanStack Query, dnd-kit, Tailwind |
| 5. Autenticação e tempo real | argon2, plugin de sessão, SSE |
| 6. Qualidade e entrega | Testcontainers, Playwright (opcional), GitHub Actions, Dependabot |
| 7. Número real (opcional) | Provedor de WhatsApp escolhido e túnel |

Instalar só o que a fase pede evita carregar bibliotecas que você ainda não entende.

## 11. Decisões em aberto sobre dependências

Acesso ao banco e migrações já foram resolvidos na D22: `pg` direto e `node-pg-migrate`. Permanecem em aberto:

- Sessão por cookie ou JWT?
- Qual provedor de IA?
- Qual provedor de WhatsApp para a etapa posterior com número real? A demonstração inicial usa o simulador (D14).
- Biome em vez de ESLint + Prettier?

## 12. Boas práticas ao gerir dependências

- **Versione o `package-lock.json` da raiz.** Ele registra a resolução das dependências do monorepo e permite reproduzi-la nas instalações.
- **Cada dependência é uma superfície de manutenção e de segurança.** Prefira o recurso nativo quando ele resolver.
- **Rode `npm audit` periodicamente** e use o Dependabot.
- **Antes de adotar um pacote,** confira a data do último release, a quantidade de issues abertas e se há mantenedor ativo.
- **Desconfie de versões recém-publicadas.** Esperar alguns dias antes de atualizar reduz o risco de pegar um release problemático.
- **Isole bibliotecas de terceiros** atrás das suas próprias interfaces (WhatsApp, IA, banco). É o mesmo princípio dos adapters e facilita trocas futuras.
