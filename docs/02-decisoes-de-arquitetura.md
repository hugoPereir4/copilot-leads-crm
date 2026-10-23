# Copiloto de Leads WhatsApp — 2. Decisões de Arquitetura

Documento de planejamento · rascunho de 22/10/2026

Cada decisão abaixo segue o mesmo formato: **o que é**, **como funciona**, **por que foi escolhida** e **o que se perde com ela**. O objetivo é que você consiga explicar cada escolha com suas próprias palavras, não só pedir ao Codex que a implemente.

## D1. Monólito modular

**Decisão confirmada em 23/10/2026.**

**Como funciona:** uma única aplicação backend Node.js, dividida internamente em módulos com fronteiras claras (mensageria, conversas, leads, qualificação por IA e autenticação). Cada módulo expõe uma interface pequena e esconde seus detalhes. O worker roda no mesmo processo na v1 (D3). O dashboard é uma aplicação frontend que se comunica com o backend pela API; estar no mesmo repositório não o coloca dentro do processo Node.js.

**Por quê:** trabalhando sozinho, microserviços trariam deploy múltiplo, comunicação por rede e depuração distribuída, sem nenhum ganho real. A modularidade dá a organização sem esse custo.

**Trade-off:** o backend é entregue e escala como uma unidade. Fronteiras bem definidas ajudam a avaliar uma futura extração de módulo, que ainda exigiria decisões de comunicação, dados e operação.

## D2. Camadas e separação de responsabilidades

**Como funciona:** o código se organiza em três camadas.

- **Entrada (rotas/controllers):** só lida com HTTP, lê a requisição e devolve a resposta.
- **Casos de uso (serviços):** contêm as regras do sistema, como "o que acontece quando chega uma mensagem".
- **Acesso a dados (repositórios):** só conversam com o banco.

A regra de dependência é simples: as camadas externas conhecem as internas, nunca o contrário. As regras de negócio não importam Express nem o cliente do banco.

Os casos de uso dependem de contratos de acesso a dados; as implementações concretas desses contratos pertencem à infraestrutura. Assim, o núcleo pode usar um repositório sem importar o driver do PostgreSQL.

**Por quê:** você consegue testar as regras sem subir servidor nem banco, e trocar uma peça (o framework, o banco) sem reescrever o que importa.

**Trade-off:** mais arquivos e mais "cerimônia" para funcionalidades simples. Vale a pena aqui porque a separação de responsabilidades é parte do que o portfólio quer demonstrar.

## D3. Webhook rápido, processamento assíncrono

**Como funciona:** quando o webhook chega, o sistema apenas valida o payload, grava a mensagem bruta e um job "pendente", e responde 200 imediatamente. Um worker, rodando no mesmo processo, pega os jobs pendentes e faz o trabalho pesado (chamar a IA, atualizar o lead).

**Por quê:** provedores de WhatsApp têm um tempo limite curto e **reenviam** o webhook se você demorar. Uma chamada ao LLM leva segundos. Se você processar dentro da requisição, tem timeouts, reenvios e mensagens duplicadas ou perdidas.

**Trade-off:** o resultado deixa de ser instantâneo (consistência eventual) e você passa a precisar de política de novas tentativas.

## D4. Fila em tabela do banco, não Redis

**Como funciona:** uma tabela de jobs guarda o status (pendente, processando, concluído, falhou), o número de tentativas e a hora da próxima tentativa. O worker consulta a tabela periodicamente e "reivindica" um job de cada vez, de forma que dois workers nunca peguem o mesmo (no PostgreSQL isso é feito com `FOR UPDATE SKIP LOCKED`).

**Por quê:** menos infraestrutura para manter, e há uma vantagem real: gravar a mensagem recebida e seu job **na mesma transação** garante que as duas gravações sejam confirmadas juntas ou desfeitas juntas. Aqui, usamos uma **fila transacional de jobs persistida no banco**.

**Trade-off:** não escala como um broker dedicado. Para esse volume, isso é irrelevante, e a troca depois fica restrita a um módulo.

## D5. Idempotência

**Como funciona:** toda mensagem do provedor traz um ID externo. O banco tem uma restrição de unicidade sobre (provedor, ID externo). Se o mesmo webhook chegar duas vezes, a segunda inserção é simplesmente ignorada.

**Por quê:** os provedores garantem entrega "pelo menos uma vez", ou seja, duplicatas **vão** acontecer. Sem idempotência você cria leads e qualificações duplicados.

**Trade-off:** praticamente nenhum. É barato e protege contra uma classe inteira de bugs.

## D6. Adapter para o provedor de WhatsApp

**Como funciona:** o sistema define sua própria interface ("receber uma mensagem normalizada", "enviar um texto"). Cada provedor (simulador, Evolution API, Cloud API oficial) tem um adapter que traduz o formato dele para o formato interno. Nenhuma outra parte do código conhece o payload do provedor.

**Por quê:** permite desenvolver e testar com o simulador, trocar de provedor se houver banimento ou mudança de API, e manter o núcleo estável. Esse padrão é conhecido como *portas e adaptadores* ou *camada anticorrupção*.

**Trade-off:** uma camada de tradução a mais para manter.

## D7. Máquina de estados da conversa

**Como funciona:** cada conversa está sempre em um estado, e só algumas transições são permitidas. Proposta inicial de estados:

- **Aguardando menu:** o bot enviou o menu e espera a escolha.
- **Aguardando detalhes:** o bot enviou as informações da opção 1 ou 2 e espera a resposta em texto livre para qualificação.
- **Qualificando:** o cliente escreveu texto livre e a IA está extraindo os dados.
- **Aguardando humano:** o lead aguarda um atendente após qualificação, fallback ou escolha direta da opção 3, que dispensa a IA.
- **Em atendimento humano:** um atendente assumiu; o bot fica em silêncio.
- **Encerrada:** permanece no histórico; se o contato voltar, uma nova conversa é iniciada (D16).

**Por quê:** regras como "o bot não responde se um humano assumiu" ficam explícitas e testáveis, em vez de `if`s espalhados pelo código. As transições válidas ficam definidas num único lugar.

**Trade-off:** exige pensar nos estados com antecedência, o que é exatamente o objetivo desta fase.

O comportamento confirmado das opções do menu está no documento 3, seção 6. Escolher falar com a recepção coloca a conversa em **Aguardando humano**; ela só entra em **Em atendimento humano** quando um atendente assume o lead no painel.

## D8. IA como extrator, com saída estruturada validada

**Como funciona:** o sistema envia a conversa ao LLM junto de um schema que descreve o JSON esperado. A resposta passa por uma **validação em tempo de execução** antes de entrar no sistema. Há um campo de confiança, um tempo máximo de espera e no máximo uma nova tentativa. Se algo falhar, o lead cai no fallback humano.

**Por quê:** o LLM não é determinístico e pode devolver JSON malformado ou valores fora do esperado. Um ponto importante de TypeScript: **os tipos só existem em tempo de compilação**. Quando um dado vem de fora (webhook, IA, requisição do painel), o compilador não protege você. A validação em runtime é a barreira real, e o tipo TypeScript é derivado dela.

**Trade-off:** custo e latência de cada chamada, e a necessidade de manter o schema e o prompt alinhados.

## D9. Tempo real com SSE

**Como funciona:** o painel abre uma conexão HTTP de longa duração e o servidor envia eventos por ela ("lead criado", "lead movido"). Em caso de queda, o navegador reconecta sozinho.

**Por quê:** o painel só precisa **receber** atualizações, e SSE é muito mais simples que WebSocket, que é bidirecional. Se precisar, polling curto serve como alternativa ainda mais simples.

**Trade-off:** a comunicação é de uma via só. Para o Kanban, isso basta.

## D10. PostgreSQL desde o início, executado localmente com Docker

**Decisão confirmada em 23/10/2026.**

**O que é:** PostgreSQL é o banco relacional que guarda contatos, conversas, mensagens, leads e jobs. Docker executa o banco em um container; Docker Compose descreve a configuração desse serviço em um arquivo versionado. São responsabilidades distintas: persistência dos dados e preparação do ambiente.

**Como funciona na primeira entrega:** executar apenas o PostgreSQL com Docker Compose, usando um volume nomeado para os dados. A aplicação se conecta ao banco por uma URL de conexão. O código da API e do painel pode rodar diretamente no ambiente de desenvolvimento; empacotá-los em containers fica para uma entrega posterior. A versão da imagem, a porta local e as variáveis serão definidas na preparação do ambiente.

**Por quê:**

- **Transações:** a mensagem recebida e seu job são gravados juntos (D3/D4). No encerramento, lead e conversa também mudam juntos (D16). Se uma operação falhar antes da confirmação da transação, as alterações dessa transação são desfeitas.
- **Unicidade:** o banco participa da proteção contra mensagens duplicadas (D5). Índices únicos parciais permitem garantir um atendimento aberto por contato sem impedir o histórico de encerrados (D16).
- **Fila no banco:** bloqueios de linha com `FOR UPDATE SKIP LOCKED` permitem reivindicar jobs disponíveis em uma tabela compartilhada. A reivindicação deve ser gravada na mesma transação; recuperação e reprocessamento continuam exigindo regras próprias (D4).
- **Ambiente reproduzível:** Compose registra a configuração do banco junto do projeto. O volume nomeado mantém os dados quando o container é recriado e reutiliza esse volume.

**Trade-off:** Docker exige instalação e recursos locais, além do aprendizado de containers, portas e volumes. A alternativa é instalar PostgreSQL diretamente na máquina, mantendo as mesmas garantias de banco e assumindo a configuração local. Um volume persistente tem ciclo de vida próprio e não substitui backup.

**Critério de pronto da entrega de ambiente:** banco saudável, conexão local validada e persistência de um dado de teste após recriar o container com o mesmo volume.

**Preferência de aprendizado:** o autor ainda não utilizou Docker. Antes de usá-lo, avisar que a etapa vai começar, explicar a finalidade das operações previstas e indicar a documentação oficial correspondente para consulta. Trabalhar em blocos pequenos, com explicação dos resultados para revisão individual.

**Referências oficiais:** [transações no PostgreSQL](https://www.postgresql.org/docs/current/tutorial-transactions.html), [índices parciais](https://www.postgresql.org/docs/current/indexes-partial.html), [bloqueios e SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE), [Docker Compose](https://docs.docker.com/compose/intro/compose-application-model/) e [persistência com volumes](https://docs.docker.com/get-started/docker-concepts/running-containers/persisting-container-data/).

## D11. Configuração do negócio como dados

**Como funciona:** nome do negócio, serviços, horário e campos de qualificação ficam numa configuração (arquivo ou tabela), não no código. Trocar de "academia" para "curso de inglês" é trocar dados.

**Por quê:** separa o que **muda** (o domínio do negócio) do que **não muda** (receber, qualificar, persistir, exibir). Prepara um futuro multi-tenant sem pagar o custo agora.

## D12. Estratégia de erros e degradação elegante

**Como funciona:**

- Erros de **domínio** (regra violada) são tipados e tratados de forma diferente dos erros de **infraestrutura** (banco fora do ar, timeout).
- Novas tentativas valem só para falhas transitórias, com intervalo crescente.
- A API devolve erros num formato único e consistente.
- A falha da IA nunca derruba o fluxo: o lead segue para um humano.

**Por quê:** o sistema fica previsível e o cliente final nunca fica sem resposta por causa de um serviço externo.

## D13. Atendimento humano pelo WhatsApp

**Decisão confirmada em 23/10/2026.**

**Como funciona:** o atendente assume o lead no painel, colocando a conversa em atendimento humano e silenciando o bot. Em seguida, usa o botão **Abrir no WhatsApp** para abrir a conversa com o número do contato e responder pelo próprio WhatsApp. Abrir o aplicativo é uma navegação; o handoff é a mudança de estado registrada pelo sistema.

**Por quê:** mantém a v1 concentrada em receber, qualificar e organizar leads. O atendimento humano usa uma ferramenta já disponível, sem exigir um editor de mensagens e controle de envio manual no painel.

**Trade-off:** o atendente alterna entre painel e WhatsApp. O histórico exibido no painel contém as mensagens registradas pelo sistema; a cópia das respostas enviadas diretamente no WhatsApp depende do provedor e não é uma garantia da v1.

## D14. Desenvolvimento e demonstração inicial com simulador

**Decisão confirmada em 23/10/2026.**

**Como funciona:** o simulador dispara webhooks de exemplo para a entrada HTTP do sistema. Um adapter simulado normaliza esses payloads e registra os envios das mensagens automáticas, sem enviá-las ao WhatsApp. A persistência, o worker, as regras da conversa e o painel seguem o fluxo da aplicação. A escolha do provedor de IA é uma decisão separada.

**Por quê:** permite desenvolver e demonstrar o fluxo sem depender de uma conta ou número conectado a um provedor de WhatsApp. Exercita a separação entre as regras de negócio e a integração externa prevista na D6.

**Trade-off:** o simulador não comprova compatibilidade com um provedor real nem entrega de mensagens no WhatsApp. Essa integração e seus testes ficam para uma etapa posterior, com provedor ainda a escolher. A demonstração inicial não depende dessa etapa.

## D15. Clínica fictícia de fisioterapia e recepção administrativa

**Decisão confirmada em 23/10/2026.**

**Como funciona:** o perfil de demonstração representa uma clínica fictícia de fisioterapia, com serviços, horários, menu e mensagens mantidos em configuração (D11). Os cenários usam dados inteiramente sintéticos. A IA identifica pedidos de informação, valores e agendamento, extrai apenas o serviço declarado e o prazo desejado informado pela pessoa e produz um resumo administrativo para a recepção.

**Limites da v1:** não realizar diagnóstico, indicar tratamento, interpretar exames ou classificar urgência clínica. O campo anteriormente chamado de urgência passa a representar o **prazo desejado para atendimento**, como texto ou nulo. Pedido de agendamento não significa reserva confirmada: a recepção continua o atendimento no WhatsApp (D13).

**Por quê:** oferece um cenário concreto para demonstrar qualificação e encaminhamento humano com um escopo viável para desenvolvimento solo. O perfil configurável permite trocar o negócio sem inserir regras específicas da clínica no núcleo.

**Trade-off:** a demonstração não valida o uso com pacientes reais nem funcionalidades clínicas. Uma eventual v2 será avaliada conforme as capacidades propostas. A revisão de privacidade, acesso, retenção e compartilhamento com a IA deve ocorrer antes de qualquer uso com dados reais, independentemente do número da versão.

## D16. Um atendimento aberto por contato e histórico preservado

**Decisão confirmada em 23/10/2026.**

**Como funciona:** um contato pode ter várias conversas ao longo do tempo, com no máximo uma aberta. Mensagens recebidas durante um atendimento continuam na conversa aberta e reutilizam o lead existente. Quando o atendimento anterior está encerrado, o retorno inicia uma nova conversa vinculada ao mesmo contato; o lead desse novo ciclo é criado no momento previsto pelo fluxo de qualificação ou encaminhamento à recepção.

O Kanban principal mostra apenas leads em **Novo**, **Qualificado** e **Em atendimento**, com no máximo um card por contato. Leads em **Ganho** ou **Perdido** ficam acessíveis pelo filtro de encerrados e pelo histórico do contato, junto das conversas e dos resultados anteriores. Novas mensagens não reabrem nem sobrescrevem os atendimentos encerrados.

**Por quê:** distingue a pessoa (contato), o ciclo de atendimento (conversa) e a oportunidade (lead), preservando os resultados sem acumular cards antigos na visualização de trabalho.

**Garantias:** a unicidade de conversa aberta e de lead aberto por contato deve ser protegida no banco e nos casos de uso, inclusive quando mensagens chegam simultaneamente. Encerrar o lead e a conversa ocorre na mesma transação. O filtro do painel apenas controla a visualização; os registros históricos continuam armazenados.

**Trade-off:** consultas e eventos do painel precisam respeitar os filtros de abertos e encerrados. A v1 não representa oportunidades simultâneas independentes para o mesmo contato.

## D17. Recepção automática fora do expediente

**Decisão confirmada em 23/10/2026.**

**Como funciona:** ao iniciar uma conversa, o sistema consulta o fuso e as faixas de atendimento do perfil do negócio. Se estiver fora do expediente, envia um aviso predefinido informando o horário da clínica junto do fluxo inicial de saudação e menu. As opções continuam funcionando: 1 e 2 seguem para qualificação após a resposta; 3 encaminha diretamente à recepção. O lead aguarda atendimento humano no painel.

O aviso e os horários são configuração, sem geração de texto pela IA. O aviso integra a abertura da conversa; não é reenviado a cada mensagem. Não cria um estado adicional nem autoriza mensagens automáticas nos estados **Aguardando humano** e **Em atendimento humano**, que continuam em silêncio.

**Por quê:** permite organizar solicitações fora do expediente e informar quando a clínica atende, mantendo o mesmo fluxo de qualificação. O menu e a IA não dependem da presença de um atendente.

**Trade-off:** o bot não garante disponibilidade da equipe nem resposta imediata. O atendimento humano depende da recepção, e a mudança de horário por si só não assume ou encerra a conversa.

## D18. Sem encerramento ou lembretes automáticos por inatividade

**Decisão confirmada em 23/10/2026.**

**Como funciona:** a ausência de novas mensagens do cliente não altera o estado da conversa, não encerra o lead e não dispara lembretes na v1. Uma conversa aguardando menu ou detalhes continua esperando a resposta. Em Aguardando humano ou Em atendimento humano, a conversa permanece no mesmo atendimento e o bot continua em silêncio. No retorno do cliente, a mensagem segue as regras do estado atual, sem abrir outra conversa ou criar outro lead apenas pelo tempo decorrido.

O encerramento de um atendimento com lead continua sendo uma ação do atendente ao marcar Ganho ou Perdido (D16). Conversas encerradas continuam sujeitas à regra de novo ciclo no retorno. Esta decisão trata de inatividade do cliente; os limites de espera da IA e a recuperação de jobs continuam funcionando conforme suas próprias políticas.

**Por quê:** mantém a v1 simples e evita encerrar uma solicitação enquanto a pessoa ainda espera pela recepção. Não exige agendamento de lembretes nem um prazo de expiração de conversa.

**Trade-off:** conversas sem resposta podem permanecer abertas por tempo indeterminado. Quando houver um lead, ele continua visível no Kanban até o encerramento pelo atendente. O campo de última mensagem permite consultar a última atividade, sem disparar ações automáticas por inatividade.

## D19. Monorepo com contratos compartilhados

**Decisão confirmada em 23/10/2026.**

**Como funciona:** manter um único repositório Git com `apps/api` (backend e worker), `apps/web` (dashboard), `packages/shared` (contratos usados pelos dois) e `docs` (documentação). **npm com workspaces**, confirmado em 23/10/2026, gerencia os pacotes. Cada aplicação possui suas dependências e pode ter comandos de desenvolvimento e builds próprios. Os workspaces são definidos no `package.json` da raiz, com um `package-lock.json` compartilhado e versionado na raiz do monorepo.

**Fronteiras:** `packages/shared` contém schemas e tipos dos contratos de API e eventos, sem importar código das aplicações. Regras internas dos módulos, acesso ao banco e integrações com provedores permanecem no backend. O frontend consome contratos e chama a API; não importa serviços ou repositórios internos do backend.

**Por quê:** permite coordenar alterações no contrato, na API e no painel no mesmo conjunto de mudanças. Incompatibilidades tipadas podem ser detectadas durante o desenvolvimento. O monorepo organiza o código e seu histórico; a D1 define a arquitetura do backend.

**Trade-off:** exige configurar as dependências entre pacotes e seus comandos. Um único repositório não garante fronteiras entre módulos nem impõe uma estratégia de commits ou branches. Uma branch pode conter alterações relacionadas de backend, frontend e contratos.

**Fluxo de Git confirmado para o projeto:** uma branch por entrega pequena, commits no padrão Conventional Commits e `main` com o estado revisado e funcionando. As regras estão no [documento 7](07-fluxo-de-desenvolvimento.md).

## D20. Express como framework HTTP

**Decisão confirmada em 23/10/2026.**

**Como funciona:** `apps/api` usa Express para receber webhooks e servir a API do dashboard. Rotas e middlewares tratam HTTP, autenticação, validação das entradas e respostas de erro. Os handlers encaminham dados validados aos casos de uso e traduzem os resultados para HTTP. O worker usa os casos de uso sem passar por uma rota.

**Por quê:** o autor está estudando Express na faculdade e deseja aprofundar o entendimento do framework no projeto. A escolha permite conectar as aulas à prática de rotas, routers, middlewares, requisições, respostas e tratamento de erros, mantendo o monólito modular da D1.

**Fronteiras:** os tipos de requisição e resposta do Express ficam na camada HTTP. Estados da conversa, regras de lead e contratos de integração não dependem do framework. Por exemplo, silenciar o bot ao assumir um lead pertence ao caso de uso; ler a requisição e devolver o status HTTP pertence ao handler.

**Trade-off:** será necessário configurar explicitamente validação, logs e tratamento padronizado de erros. As bibliotecas de apoio serão escolhidas nas respectivas entregas. Fastify foi considerado como alternativa; Express foi escolhido por sua adequação ao aprendizado atual do autor.

**Acompanhamento:** explicar os conceitos do Express conforme aparecerem no código e mostrar sua relação com as camadas e os módulos. A versão será verificada e fixada na preparação das dependências.

Referências: [rotas](https://expressjs.com/en/guide/routing.html), [middlewares](https://expressjs.com/en/guide/using-middleware/) e [tratamento de erros](https://expressjs.com/en/guide/error-handling.html).

## D21. Zod para validação nas fronteiras

**Decisão confirmada em 23/10/2026.**

**Como funciona:** dados externos entram como `unknown` e são validados por schemas Zod antes de serem usados pelos casos de uso. Os tipos TypeScript dos contratos são derivados dos schemas. A validação cobre webhooks, requisições do painel, saída da IA, configuração do negócio e variáveis de ambiente aplicáveis ao modo escolhido.

**Fronteiras:** schemas dos contratos de API e eventos compartilhados ficam em `packages/shared`. Schemas específicos do provedor de WhatsApp, da integração de IA e das configurações do servidor permanecem no backend. O dado validado segue para o caso de uso; os detalhes de erro do Zod são traduzidos para o erro padronizado da API ou para a política de fallback da IA, conforme a origem.

**Por quê:** complementa a tipagem estática com verificação em execução e mantém os contratos alinhados aos tipos. Permite exercitar a separação entre validação de dados e regras de negócio.

**Limites:** validar estrutura e restrições não comprova a veracidade da extração da IA. Permissões, transições de estado e decisões que dependem do banco continuam nos casos de uso e nas garantias de persistência. A conversão de schemas para JSON Schema, quando usada na integração de IA, deve respeitar o suporte do provedor escolhido.

**Trade-off:** os schemas precisam ser mantidos e versionados com os contratos. A dependência fica concentrada nas fronteiras, sem espalhar validações repetidas por todas as chamadas internas. A versão será fixada na preparação das dependências.

Referências: [schemas e tipos derivados](https://zod.dev/basics), [restrições dos schemas](https://zod.dev/api) e [conversão para JSON Schema](https://zod.dev/json-schema).

## Forma de trabalho para estudar arquitetura

O objetivo é aprender arquitetura durante o desenvolvimento, com uma entrega pequena por vez e revisão individual do autor. Em cada entrega, explicar com exemplos do próprio projeto:

- qual módulo é responsável pelo comportamento e por quê;
- onde fica a regra de negócio e como se separa de HTTP, banco e provedores;
- quais interfaces o módulo expõe ou consome e a direção das dependências;
- qual alternativa foi considerada, o custo da escolha e como verificar a regra implementada.

Conectar as explicações às decisões deste documento e ao código da entrega. Explicar o conceito quando ele aparecer, antes de acrescentar novas abstrações. A preferência de acompanhamento de Docker permanece na D10.
