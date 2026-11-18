# Backlog técnico

Pendências técnicas levantadas na revisão completa do repositório, com a base em `fix/gemini-timeout-padrao-25s` (`2d7f535`). Ficam registradas para tratar **depois que as funcionalidades básicas da v1 estiverem prontas**. Este documento não propõe a correção em detalhe: o desenho de cada item será discutido quando ele for tratado, com atualização do documento de decisão correspondente (D1–D22 em [docs/02](02-decisoes-de-arquitetura.md)).

Cada item informa o que é, onde está, o impacto, a situação e o próximo passo.

- **Confirmado:** verificado lendo o código ou rodando os testes.
- **Suspeita:** deduzido da leitura, ainda não reproduzido.

Os números de linha valem para o commit base acima e podem mudar.

## Ordem sugerida

Quando o backlog for retomado: **3** (integração estável), **1a**, **1b**, **2** e **5**. Os itens de **4** são registros de acompanhamento e entram quando houver trabalho de observabilidade ou de qualificação. Os itens de **6** (login) entram antes de qualquer exposição do painel fora do loopback; o 6b depende da regra de posse do lead.

## 1. Bugs suspeitos

Ainda não reproduzidos. Para os dois, o primeiro passo é um teste que reproduza o comportamento.

### 1a. Texto "Pedido direto à recepção" em leads que não são pedido direto

- **O que é:** o card do Kanban mostra "Pedido direto à recepção. Aguardando atendimento humano." para qualquer lead em Novo sem `summary`. Isso inclui leads com qualificação em processamento e falhas de qualificação sem campos comprovados, não só quem escolheu a opção da recepção no menu.
- **Onde:** [apps/web/src/demo.ts:154-155](../apps/web/src/demo.ts#L154-L155).
- **Impacto:** só exibição. A recepção pode confundir uma falha de qualificação, ou uma qualificação em andamento, com um pedido direto. O selo Revisar e os campos de qualificação continuam aparecendo quando existem.
- **Situação:** suspeita. A condição foi lida no código, mas a tela não foi observada nesses casos.
- **Próximo passo:** um teste em `apps/web/scripts/demo-ui.test.js` com um lead Novo em processamento e outro com `status: "falha"`, verificando o texto exibido.

### 1b. Plano de resposta pendente órfão bloqueia opções do menu

- **O que é:** um job pode falhar definitivamente com um plano de resposta que não é de abertura ainda `pendente`. Nesse caso, uma nova opção de menu na mesma conversa não consegue preparar o próprio plano: a gravação devolve `adiado` (`resposta_anterior_pendente`), e o processador trata isso como erro transitório. O job novo é reagendado até esgotar as tentativas. Só um texto livre, que leva à qualificação, cancela os planos pendentes da conversa.
- **Onde:**
  - devolução de `adiado`: [postgres-message-response-plan-store.ts:76-78](../apps/api/src/modules/messaging/infrastructure/postgres-message-response-plan-store.ts#L76-L78);
  - erro lançado: [simulator-processor.ts:58](../apps/api/src/modules/simulator/application/simulator-processor.ts#L58);
  - classificação como transitória: [simulator-processor.ts:65](../apps/api/src/modules/simulator/application/simulator-processor.ts#L65);
  - cancelamento pela qualificação: [postgres-qualification-execution-store.ts:85-88](../apps/api/src/modules/leads/infrastructure/postgres-qualification-execution-store.ts#L85-L88).
- **Impacto:** raro, porque exige esgotar as tentativas do job original com o plano ainda pendente. Fica restrito a uma conversa e tem saída pelo texto livre. Enquanto dura, o contato não recebe resposta às opções do menu.
- **Situação:** suspeita. O caminho foi seguido na leitura, mas não há teste que monte o cenário.
- **Próximo passo:** um teste de integração que deixe um plano não-abertura pendente com o job em `falhou` e envie uma opção de menu na mesma conversa.

## 2. Divergências entre código e documentação

### 2a. D7: estado `qualificando` e transições espalhadas

- **O que é:** a [D7](02-decisoes-de-arquitetura.md) prevê o estado `qualificando` e as transições "definidas num único lugar". No código, a qualificação leva a conversa direto a `aguardando_humano`, e `qualificando` nunca é gravado. Mesmo assim, ele ainda é filtrado em três lugares do backend:
  1. [postgres-job-queue.ts:29](../apps/api/src/modules/jobs/infrastructure/postgres-job-queue.ts#L29): a reserva de jobs no modo demo ignora conversas em `qualificando`;
  2. [decide-message-processing.ts:32](../apps/api/src/modules/messaging/application/decide-message-processing.ts#L32): a decisão devolve `adiar` para esse estado;
  3. [postgres-human-handoff-store.ts:31](../apps/api/src/modules/leads/infrastructure/postgres-human-handoff-store.ts#L31): a assunção aceita conversas em `qualificando`.

  O frontend também o lista entre os estados que permitem assumir ([apps/web/src/demo.ts:174](../apps/web/src/demo.ts#L174)). A decisão ainda propõe `nextStatus: "qualificando"` ([decide-message-processing.ts:37](../apps/api/src/modules/messaging/application/decide-message-processing.ts#L37) e [:62](../apps/api/src/modules/messaging/application/decide-message-processing.ts#L62); [simulator-processor.ts:46](../apps/api/src/modules/simulator/application/simulator-processor.ts#L46)), mas esse valor não é aplicado. As transições, por sua vez, estão em quatro adapters SQL, e não num ponto único:
  - [postgres-simulator-effects.ts:74](../apps/api/src/infrastructure/simulator/postgres-simulator-effects.ts#L74) e [:91](../apps/api/src/infrastructure/simulator/postgres-simulator-effects.ts#L91);
  - [postgres-qualification-execution-store.ts:89-92](../apps/api/src/modules/leads/infrastructure/postgres-qualification-execution-store.ts#L89-L92);
  - [postgres-human-handoff-store.ts:43-44](../apps/api/src/modules/leads/infrastructure/postgres-human-handoff-store.ts#L43-L44);
  - [postgres-lead-closure-store.ts:39-41](../apps/api/src/modules/leads/infrastructure/postgres-lead-closure-store.ts#L39-L41).
- **Impacto:** nenhum erro em execução hoje. O custo é de manutenção: regras de estado na infraestrutura (em parte contra a D2) e um estado morto que continua sendo tratado.
- **Situação:** confirmado. O [docs/32](32-qualificacao-de-leads.md) registra que a conversa não passa por `qualificando`.
- **Próximo passo:** decidir entre remover `qualificando` da D7 e do código ou passar a usá-lo; depois, decidir se as transições vão para uma máquina de estados na aplicação. Atualizar a D7 nos dois casos.

### 2b. Contrato da IA no docs/05

- **O que é:** a seção "Saída futura da IA" lista `serviceInterest`, `desiredTimeframe`, `contactName`, `extraFields`, `confidence` e `needsHuman`. O contrato implementado usa `intent`, `serviceId`, `period`, `summary`, `needsReview` e `evidence`.
- **Onde:** [docs/05-contratos-de-dados.md:125-134](05-contratos-de-dados.md) e [apps/api/src/modules/leads/contracts/qualification.ts:6-13](../apps/api/src/modules/leads/contracts/qualification.ts#L6-L13).
- **Impacto:** documentação desatualizada sobre o contrato mais sensível do projeto.
- **Situação:** confirmado.
- **Próximo passo:** reescrever a seção do docs/05 a partir do schema Zod real e fechar os pontos em aberto que o código já decidiu.

### 2c. `packages/shared` sem schemas Zod

- **O que é:** a documentação diz que `packages/shared` contém schemas, além de tipos. Na prática, o pacote só tem `type` e não depende de `zod`. O frontend aplica asserções `as` às respostas da API, contra a regra prática do docs/05 ("não usar `as` em dados externos").
- **Onde:**
  - doc: [docs/02:228](02-decisoes-de-arquitetura.md) (D19), [docs/02:258](02-decisoes-de-arquitetura.md) (D21), [docs/05:207](05-contratos-de-dados.md) e a regra em [docs/05:18](05-contratos-de-dados.md);
  - código: [packages/shared/src/](../packages/shared/src/) e [apps/web/src/demo.ts:23](../apps/web/src/demo.ts#L23) e [:26](../apps/web/src/demo.ts#L26).
- **Impacto:** o painel não valida em tempo de execução o que recebe da API. Uma mudança incompatível só aparece como erro de tela.
- **Situação:** confirmado.
- **Próximo passo:** decidir entre mover schemas Zod para `shared` (D19/D21 como estão) ou registrar nas decisões que `shared` fica só com tipos.

### 2d. Histórico de entregas desatualizado no README e no docs/07

- **O que é:** o docs/07 termina na etapa 4.20, sem registro das branches `simulator-demo-flow`, `dashboard-ui`, `human-handoff`, `lead-closure` e `lead-qualification-core`, nem das correções do Gemini. No README, a seção "Estado atual" já cita as entregas até a qualificação. Mas o parágrafo da linha 13 ainda chama `feat/human-handoff` de "a entrega mais recente". E o índice "Revisão e aprendizado" não tem os documentos 29 a 32.
- **Onde:** [docs/07-fluxo-de-desenvolvimento.md](07-fluxo-de-desenvolvimento.md) (último registro: etapa 4.20) e [README.md:13](../README.md) e o índice "Revisão e aprendizado" do README. A tabela de scripts do README também está defasada: `check` também roda os testes da web, e `diagnose:gemini` não aparece.
- **Impacto:** quem chega ao projeto pelo README ou pelo docs/07 tem uma visão antiga do estado.
- **Situação:** confirmado.
- **Próximo passo:** atualizar o docs/07 e o README de uma vez, de preferência junto com a estratégia de integração na `main` (item 5b).

### 2e. Tratamento inalcançável de `solicitar_qualificacao` nos efeitos

- **O que é:** `PostgresSimulatorEffects.apply` ainda trata a ação `solicitar_qualificacao`, mas o processador encaminha essa ação para a qualificação antes de chamar os efeitos. Na prática, o ramo só roda para `solicitar_recepcao`, e `needsReview` ali é sempre falso.
- **Onde:** [postgres-simulator-effects.ts:83-90](../apps/api/src/infrastructure/simulator/postgres-simulator-effects.ts#L83-L90); desvio em [simulator-processor.ts:49-52](../apps/api/src/modules/simulator/application/simulator-processor.ts#L49-L52).
- **Impacto:** código legado que confunde a leitura do fluxo.
- **Situação:** confirmado por leitura.
- **Próximo passo:** remover o ramo e conferir se o texto de resumo correspondente em `postgres-reception-lead-store.ts` também fica sem uso.

### 2f. `CLAUDE.md` fora do versionamento

- **O que é:** o `CLAUDE.md` é citado como contexto do projeto, mas não está versionado. Ele existe só na cópia de trabalho do autor, como arquivo não rastreado.
- **Onde:** raiz do repositório (`git ls-files CLAUDE.md` não retorna nada).
- **Impacto:** quem clona o repositório não recebe as instruções de trabalho.
- **Situação:** confirmado.
- **Próximo passo:** o autor decide se versiona o arquivo, e em qual branch.

## 3. Testes e infraestrutura

### 3a. Limite de tempo da suíte "fluxo vertical do simulador"

- **O que é:** a suíte tem limite total de 60 s ([simulator-flow.integration.test.ts:37](../apps/api/src/infrastructure/simulator/simulator-flow.integration.test.ts#L37)). O `npm run test:integration` roda os arquivos em paralelo contra o mesmo container, e a suíte já levou 52,6 s.
- **Onde:** a falha observada foi numa execução de `test:integration` na branch `fix/gemini-retry-transitorio`. A suíte estourou o limite (`test timed out after 60000ms`), o teste em andamento foi cancelado e os 26 seguintes não chegaram a rodar. Rodada sozinha, a mesma suíte passou em 19,5 s, e a execução completa seguinte passou.
- **Impacto:** resultado intermitente na validação de integração. Uma falha por tempo pode esconder uma falha real, ou ser confundida com ela.
- **Situação:** confirmado (falha observada uma vez, em seguida passou).
- **Próximo passo:** resolver **antes de integrar na `main`**. Medir os tempos por teste e decidir entre dividir a suíte, ajustar o limite ou limitar a concorrência das suítes.

## 4. Observabilidade e qualificação

Registros de acompanhamento, não bugs.

### 4a. Linha `gemini_qualification_retry` sem `jobId`

- **O que é:** o aviso de nova tentativa sai do adapter, que não conhece o job. A linha traz `diagnosticId` e os campos do diagnóstico, mas não o `jobId`. Hoje a correlação com a linha `gemini_qualification_failure` (que tem `jobId`) é feita pelo horário.
- **Onde:** [apps/api/src/demo.ts:30-33](../apps/api/src/demo.ts#L30-L33) e o `onRetry` em [gemini-lead-qualifier.ts](../apps/api/src/modules/leads/infrastructure/gemini-lead-qualifier.ts).
- **Impacto:** com mais de uma qualificação em paralelo, a correlação pelo horário deixa de ser confiável.
- **Situação:** confirmado (limitação conhecida da implementação).
- **Próximo passo:** tratar junto com a correlação por mensagem pedida em [docs/01](01-escopo-e-requisitos.md) (observabilidade).

### 4b. Latência do Gemini real

- **O que é:** a medição manual teve 4 chamadas válidas, com 1,25 s, 1,99 s, 11,72 s e mais de 15 s (timeout). Ela motivou o padrão de 25 s de `QUALIFIER_TIMEOUT_MS`.
- **Onde:** [apps/api/src/config/qualification.ts](../apps/api/src/config/qualification.ts) e o registro no [docs/32](32-qualificacao-de-leads.md).
- **Impacto:** a amostra é pequena; o padrão pode estar alto ou baixo demais.
- **Situação:** confirmado (medição registrada), conclusão provisória.
- **Próximo passo:** repetir com mais amostras sintéticas e rever o padrão e `MIN_RETRY_BUDGET_MS`.

### 4c. Teste manual de retry por erro de rede

- **O que é:** teste manual opcional, ainda não feito: com a internet desligada, uma qualificação com Gemini deve registrar `gemini_qualification_retry` e, em seguida, `gemini_qualification_failure`.
- **Onde:** fluxo de `npm run start:demo` com `QUALIFIER_PROVIDER=gemini`. Os testes automatizados cobrem o caso com transporte fake em [lead-qualification.test.ts](../apps/api/src/modules/leads/application/lead-qualification.test.ts).
- **Impacto:** nenhum enquanto o comportamento automatizado estiver coberto; confirmaria o código de rede real devolvido pelo SDK.
- **Situação:** não executado.
- **Próximo passo:** executar quando for conveniente, com dados sintéticos e ciente do consumo de cota.

## 5. Decisões registradas

### 5a. Falha SQL ao aplicar o resultado da qualificação

- **O que é:** se a transação que aplica o resultado falhar, a reserva em `qualification_runs` é mantida, e a próxima tentativa cai em revisão humana sem repetir a chamada externa.
- **Onde:** política documentada em [docs/32](32-qualificacao-de-leads.md) ("Arquitetura e garantias"), coberta pelo teste "rollback de resultado parcial mantém reserva..." em [simulator-flow.integration.test.ts](../apps/api/src/infrastructure/simulator/simulator-flow.integration.test.ts).
- **Impacto:** pode perder uma classificação válida ainda não confirmada, em troca de não gastar cota de novo.
- **Situação:** decisão tomada, **não é bug**.
- **Próximo passo:** nenhum. Não reabrir sem decisão explícita do autor.

### 5b. Integração na `main`

- **O que é:** a `main` continua no commit inicial. Há mais de 10 branches empilhadas, nenhuma integrada.
- **Onde:** histórico do Git.
- **Impacto:** quanto mais branches, maior o trabalho de revisão e integração no fim.
- **Situação:** decisão adiada.
- **Próximo passo:** definir a estratégia no fim da v1, depois do item 3a.

## 6. Pendências do login de atendentes

Levantadas na entrega [login de atendentes](34-login-de-atendentes.md) (D23). Ficam fora dela por decisão de escopo.

### 6a. Limite de tentativas de login

- **O que é:** não há limite de tentativas por usuário nem por origem. Cada login roda uma derivação scrypt de cerca de 128 MiB (N = 2^17, r = 8).
- **Onde:** [apps/api/src/modules/auth/http/auth-routes.ts](../apps/api/src/modules/auth/http/auth-routes.ts) e [scrypt-password-hasher.ts](../apps/api/src/modules/auth/infrastructure/scrypt-password-hasher.ts).
- **Impacto:**
  - **Senhas:** permite tentar senhas sem freio; o custo do scrypt só reduz a velocidade.
  - **Memória:** muitos logins simultâneos somam 128 MiB cada um (por exemplo, 8 em paralelo usam cerca de 1 GiB) e podem esgotar a memória do processo.
  - **Contexto:** hoje mitigado por o servidor escutar só em `127.0.0.1`.
- **Situação:** confirmado (ausência conhecida).
- **Próximo passo:** decidir a política (atraso progressivo, bloqueio temporário ou limite de logins simultâneos) antes de expor o painel fora do loopback.

### 6b. Registro de quem assumiu ou encerrou

- **O que é:** o atendente autenticado fica em `response.locals.attendant`, mas nenhum caso de uso o recebe. Leads não guardam quem assumiu nem quem encerrou.
- **Onde:** [apps/api/src/modules/auth/http/require-session.ts](../apps/api/src/modules/auth/http/require-session.ts) e as rotas em [apps/api/src/modules/leads/http/](../apps/api/src/modules/leads/http/).
- **Impacto:** sem auditoria de autoria; o quadro não mostra o responsável pelo atendimento.
- **Situação:** confirmado. Há uma **decisão em aberto**: um atendente pode assumir ou encerrar um lead que outro atendente já assumiu?
- **Próximo passo:** decidir a regra de posse e o modelo (coluna no lead ou `lead_events`, já proposta no [docs/04](04-modelagem-de-dados.md)); depois, passar o atendente aos casos de uso.

### 6c. Desativação de atendente

- **O que é:** não há como desativar um atendente sem apagá-lo. Apagar remove as sessões em cascata, mas perde o histórico de autoria quando ele existir.
- **Onde:** [apps/api/migrations/1795046400000_create_attendants.sql](../apps/api/migrations/1795046400000_create_attendants.sql) e [apps/api/src/scripts/attendant-admin.ts](../apps/api/src/scripts/attendant-admin.ts).
- **Impacto:** a única forma de cortar o acesso hoje é trocar a senha (`attendant:set-password`) ou apagar a linha manualmente.
- **Situação:** confirmado (ausência conhecida).
- **Próximo passo:** acrescentar estado ativo/inativo e um comando no CLI, junto com o item 6b.

### 6d. HTTPS e cookie `Secure` fora do loopback

- **O que é:** o servidor só fala HTTP e escuta em `127.0.0.1`. O padrão é `SESSION_COOKIE_SECURE=false`. A checagem de Origin compara com `http://` + `Host`.
- **Onde:** [apps/api/src/http/listen-http.ts](../apps/api/src/http/listen-http.ts), [apps/api/src/config/auth.ts](../apps/api/src/config/auth.ts) e [origin-guard.ts](../apps/api/src/modules/auth/http/origin-guard.ts).
- **Impacto:** expor o painel em rede sem HTTPS transmitiria senha e cookie em texto claro. Atrás de um proxy HTTPS, a checagem de Origin recusaria as requisições do próprio painel.
- **Situação:** confirmado (limitação documentada no `.env.example`).
- **Próximo passo:** antes de qualquer exposição, definir terminação TLS, ligar `SESSION_COOKIE_SECURE=true` e configurar a origem esperada.

### 6e. Token sincronizador para clientes sem Origin confiável

- **O que é:** a proteção CSRF depende do header `Origin` enviado pelo navegador. Requisições sem `Origin` passam.
- **Onde:** [origin-guard.ts](../apps/api/src/modules/auth/http/origin-guard.ts).
- **Impacto:** nenhum com os navegadores atuais e o cookie `SameSite=Lax`. Passaria a importar se surgir um cliente que envie o cookie sem um `Origin` confiável.
- **Situação:** registro preventivo.
- **Próximo passo:** se esse cliente surgir, acrescentar um token sincronizador por sessão nas requisições que alteram estado.
