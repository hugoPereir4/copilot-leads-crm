# Copiloto de Leads WhatsApp — 1. Escopo e Requisitos da v1

Documento de planejamento · rascunho de 22/10/2026

## 1. Visão geral

Sistema que recebe mensagens de interessados em uma clínica fictícia de fisioterapia via WhatsApp, identifica a intenção administrativa com um LLM e entrega o lead estruturado num painel Kanban para o atendente humano. O perfil da clínica é configurável, mantendo as regras centrais independentes desse negócio.

**Objetivo da v1, em uma frase:** uma mensagem de texto chega, vira um lead qualificado e estruturado, aparece no Kanban e um humano consegue assumir o atendimento.

## 2. Decisões já tomadas

- A v1 trata **apenas texto**. Áudio fica para a v1.1.
- A IA **só qualifica**. Ela nunca escreve ao cliente.
- As mensagens automáticas que o cliente lê vêm de **mensagens pré-definidas** (saudação e menu numerado), controladas por você.
- Projeto **single-tenant**: um negócio por instalação.
- O atendente responde pelo próprio **WhatsApp**, acessado pelo botão **Abrir no WhatsApp** no painel. O painel não envia mensagens manuais na v1 (D13).
- O desenvolvimento e a demonstração inicial usam o **simulador**. A integração com um número real fica para uma etapa posterior, com provedor ainda a escolher (D14).
- O cenário é uma **clínica fictícia de fisioterapia**, com foco em recepção administrativa: informações sobre serviços, valores e pedidos de agendamento (D15).
- A demonstração usa **dados inteiramente sintéticos**, sem conversas ou dados de pacientes reais. Funcionalidades clínicas ficam fora da v1; eventual expansão será reavaliada em uma versão futura (D15).
- Cada contato tem no máximo uma conversa e um lead abertos. O retorno após encerramento inicia uma nova conversa, preservando os atendimentos anteriores no histórico. O Kanban principal mostra apenas os leads abertos (D16).
- Fora do expediente, o bot informa o horário configurado da clínica e continua com o menu e a qualificação. A solicitação aguarda atendimento humano, sem promessa de resposta imediata (D17).
- Conversas abertas permanecem abertas quando o cliente para de responder, sem lembretes nem encerramento automático por inatividade. O retorno continua no estado atual do atendimento (D18).
- PostgreSQL desde o início, executado localmente com Docker Compose e volume persistente. A primeira entrega de ambiente coloca apenas o banco em container (D10).
- Backend em **monólito modular** (D1), organizado em um **monorepo** com API, dashboard e contratos compartilhados em pacotes separados, gerenciados por **npm com workspaces** (D19).
- **Express** como framework HTTP do backend, alinhado às aulas da faculdade e ao objetivo de compreender seu funcionamento durante o projeto (D20).
- **Zod** para validação em execução nas fronteiras e derivação dos tipos TypeScript dos contratos (D21).

## 3. Dentro do escopo da v1

- Receber mensagens de texto por webhook.
- Persistir conversa, mensagens e lead.
- Menu numerado determinístico no primeiro contato.
- Qualificação por LLM com saída estruturada e validada.
- Kanban com colunas fixas e atualização sem recarregar a página.
- Fallback para atendimento humano quando a IA falha ou tem baixa confiança.
- Login simples para atendentes.
- Botão **Abrir no WhatsApp** para continuar o atendimento humano fora do painel.
- Simulador de webhooks para desenvolvimento e demonstração.

**Interfaces da v1:** o cliente interage pelo WhatsApp; não há portal ou página web para clientes. O painel web é usado pelos atendentes da clínica, com login simples e sem separação de papéis complexa. Na demonstração inicial, o simulador representa as mensagens do cliente. O formato do simulador (script, ferramenta HTTP ou interface visual) ainda será definido; uma página de chat não é requisito da v1.

## 4. Fora do escopo da v1

| Item | Por que fica de fora | Quando entra |
|---|---|---|
| Áudio e transcrição | Adiciona mídia, mais um ponto de falha e custo | v1.1, como um passo extra do pipeline |
| Multi-tenant | Exige isolamento de dados e painel de configuração | v2 |
| IA respondendo ao cliente | Risco de resposta errada e controle de handoff | v2, com guardrails |
| Envio de mensagens manuais pelo painel | O atendente responde diretamente no WhatsApp | Futuro, se necessário |
| Diagnóstico, indicação de tratamento, interpretação de exames e triagem clínica por IA | A v1 organiza solicitações administrativas | Fora da v1; eventual inclusão exige avaliação específica |
| Prontuário e integração com agenda clínica | A v1 registra o pedido de agendamento; a recepção dá continuidade | Futuro, se necessário |
| Filas externas (Redis etc.) | A fila em tabela do banco basta | Se houver volume que justifique |
| Colunas Kanban customizáveis | Complexidade de interface sem valor para a v1 | v2 |
| Billing, roles complexos, relatórios | Não são o núcleo do problema | Futuro |

## 5. Requisitos funcionais

| ID | Requisito |
|---|---|
| RF01 | Receber mensagens de texto por webhook de um provedor de WhatsApp (real ou simulado). |
| RF02 | Validar o payload recebido e armazenar a mensagem bruta antes de qualquer processamento. |
| RF03 | Ignorar mensagens duplicadas (mesmo ID externo do provedor). |
| RF04 | No primeiro contato, enviar saudação e menu numerado pré-definidos. |
| RF05 | Interpretar a opção digitada; opção inválida reenvia o menu. |
| RF06 | Em texto livre, qualificar via LLM: intenção administrativa, serviço de interesse declarado, prazo desejado para atendimento, dados de contato, resumo administrativo e nível de confiança. O prazo é extraído apenas se informado, sem inferir gravidade clínica. |
| RF07 | Validar a saída da IA contra um schema; se inválida, marcar o lead para revisão humana. |
| RF08 | Criar ou atualizar o lead a partir da conversa. |
| RF09 | Exibir os leads num Kanban e permitir mover cards entre colunas. |
| RF10 | Atualizar o painel sem recarregar a página. |
| RF11 | Mostrar ao atendente o histórico de mensagens registrado pelo sistema e o resumo gerado pela IA. |
| RF12 | Quando o atendente assume o lead, o bot para de enviar mensagens automáticas (handoff). |
| RF13 | Autenticar atendentes com login e senha. |
| RF14 | Ler nome do negócio, serviços, horário e campos de qualificação de uma configuração, não do código. |
| RF15 | Disponibilizar um simulador que dispara webhooks de exemplo. |
| RF16 | Disponibilizar no painel um botão **Abrir no WhatsApp** que abre a conversa com o número do contato para o atendente responder fora do sistema. |
| RF17 | Na opção 1 do menu, enviar a apresentação configurada dos serviços e perguntar qual interessa; na opção 2, enviar valores e horários configurados e perguntar se deseja solicitar agendamento. Qualificar a resposta em texto livre. Na opção 3, criar o lead em Novo e colocar a conversa em Aguardando humano, sem chamar a IA. |
| RF18 | Vincular novas mensagens à conversa aberta do contato e reutilizar seu lead, quando já existir. Se não houver conversa aberta, iniciar uma nova vinculada ao mesmo contato, preservando as anteriores encerradas. |
| RF19 | Mostrar apenas leads abertos no Kanban principal, com no máximo um card por contato. Disponibilizar filtro de encerrados e acesso ao histórico de conversas e leads do contato, com seus resultados. |
| RF20 | Ao iniciar uma conversa fora do expediente, enviar um aviso predefinido com o horário da clínica e continuar com o menu e a qualificação. Usar o fuso e os horários do perfil do negócio; preservar o silêncio do bot nas conversas aguardando humano ou em atendimento humano. |
| RF21 | Preservar o estado e o atendimento existente após períodos sem resposta do cliente, sem lembretes ou encerramento automático por inatividade. Processar a próxima mensagem conforme o estado atual, sem reiniciar o menu nem criar outra conversa ou lead apenas pelo tempo decorrido. |

## 6. Etapas e visualização do Kanban

Etapas comerciais fixas: Novo → Qualificado → Em atendimento → Ganho / Perdido.

A visualização principal contém as colunas **Novo**, **Qualificado** e **Em atendimento**, com no máximo um card por contato. Mover para **Ganho** ou **Perdido** encerra o atendimento e retira o card da visualização principal. Os resultados continuam acessíveis pelo filtro de encerrados e pelo histórico do contato (D16).

Leads em que a IA falhou ou teve baixa confiança ficam em **Novo** com um indicador **Revisar**, em vez de uma coluna própria. Assim o fluxo continua simples.

Pedidos diretos para falar com a recepção (opção 3) também entram em **Novo**, mas sem o indicador **Revisar**: dispensar a IA nesse caminho é uma escolha do fluxo, não uma falha de qualificação. O atendente assume o lead posteriormente.

## 7. Requisitos não funcionais

- **Tipagem estrita:** TypeScript em modo `strict`, sem `any` nas fronteiras do sistema.
- **Validação nas fronteiras:** todo dado externo (webhook, resposta da IA, requisição do painel) é validado antes de entrar no domínio.
- **Tratamento de erros padronizado:** erros tipados, com resposta consistente da API.
- **Resiliência:** o webhook responde rápido e o processamento pesado é assíncrono.
- **Idempotência:** receber a mesma mensagem duas vezes não cria dados duplicados.
- **Observabilidade:** logs estruturados com um identificador de correlação por mensagem.
- **Segredos** (chaves de API) apenas em variáveis de ambiente.
- **Testes** nos fluxos críticos: idempotência, máquina de estados, validação da saída da IA.
- **Privacidade (LGPD, nível básico):** guardar só o necessário de dados pessoais e não registrar o conteúdo das mensagens em logs.
- **Dados da demonstração:** criar cenários inteiramente sintéticos, sem importar conversas de pacientes. O uso futuro com dados reais exige revisão das decisões de privacidade e das integrações antes da conexão, mesmo que o sistema continue limitado à recepção administrativa.

## 8. Critério de "pronto" da v1

Você consegue disparar uma conversa pelo simulador e ver, de ponta a ponta:

1. a mensagem persistida;
2. o envio do menu registrado pelo adapter simulado;
3. o lead qualificado com dados estruturados;
4. o card no Kanban, atualizado sem recarregar;
5. o atendente assumindo o lead, o bot silenciando e o botão **Abrir no WhatsApp** direcionando ao número do contato;
6. um caso de falha da IA caindo no fallback humano;
7. cada opção do menu seguindo o comportamento confirmado, incluindo o pedido direto à recepção sem chamada à IA;
8. mensagens sucessivas durante um atendimento mantendo o mesmo card; após o encerramento, um novo atendimento preservando o histórico sem exibir cards antigos no Kanban principal;
9. uma conversa iniciada fora do expediente exibindo o aviso de horário e seguindo até a qualificação ou o encaminhamento à recepção;
10. um período sem resposta do cliente preservando a conversa aberta e seu estado, sem lembretes; no retorno, a mensagem seguindo o atendimento existente, sem criar outro card por inatividade.

Na demonstração inicial, não é necessário conectar um número real nem enviar mensagens reais. O botão **Abrir no WhatsApp** deve direcionar ao número informado no cenário; a validação do link não exige concluir um atendimento real.

## 9. Riscos principais

- **WhatsApp não oficial (Baileys, Evolution API):** pode causar banimento do número. Mitigação: adapter isolado e chip dedicado na demonstração.
- **Escopo crescendo:** áudio e resposta da IA são as tentações mais fortes. Mantenha-os fora da v1.
- **Custo e latência do LLM:** limitar o tamanho do contexto enviado e definir um tempo máximo de espera.

## 10. Propostas ainda a confirmar

Estes pontos foram sugeridos, mas ainda não decididos:

- Tempo real com SSE ou polling, em vez de WebSocket.
