# Copiloto de Leads WhatsApp — 5. Contratos de Dados

Documento de planejamento · rascunho de 22/10/2026

Um contrato de dados define exatamente que formato um dado tem ao cruzar uma fronteira do sistema. Este documento descreve os contratos em tabelas, sem código. A implementação virá depois, a partir destas definições.

## 1. O princípio: schema primeiro, tipo derivado

Os tipos do TypeScript **desaparecem na execução**. Eles protegem o seu código enquanto você escreve, mas não impedem que um webhook, uma resposta de IA ou uma requisição do painel chegue com formato diferente do esperado.

Por isso, em cada fronteira o fluxo é este:

1. O dado entra como `unknown` (desconhecido).
2. Um **schema Zod** o valida em execução, conforme a decisão D21.
3. O **tipo TypeScript é derivado do schema**, nunca escrito à mão em paralelo. Assim os dois não divergem.
4. Só depois de validado o dado entra no domínio.

Regra prática: não usar `as` (asserção de tipo) em dados externos. Ele silencia o compilador sem verificar nada.

## 2. Mapa das fronteiras

| Fronteira | Direção | Confiança | Contrato |
|---|---|---|---|
| Provedor de WhatsApp para o backend | Entrada | Nenhuma | Payload do webhook |
| Adapter para o domínio | Interna | Alta | Mensagem normalizada |
| Backend para o LLM | Saída | N/A | Prompt e schema pedido |
| LLM para o backend | Entrada | Nenhuma | Resultado da qualificação |
| Painel para o backend | Entrada | Nenhuma | Requisições da API |
| Backend para o painel | Saída | N/A | Respostas da API e eventos SSE |
| Arquivo ou tabela para o backend | Entrada | Parcial | Perfil do negócio |

## 3. Payload do webhook (externo)

O formato exato depende do provedor escolhido. **Confirme os nomes de campos na documentação do provedor** antes de definir o schema, e não assuma o formato de memória. O que o sistema precisa extrair, de forma geral:

| Informação | Por que importa |
|---|---|
| ID da mensagem no provedor | Idempotência |
| Número do remetente | Identificar o contato |
| Indicador de mensagem enviada por nós mesmos | Evitar processar nossas próprias respostas |
| Tipo da mensagem (texto, áudio, imagem...) | Na v1 só texto é processado; os demais são registrados e ignorados |
| Texto | Conteúdo a qualificar |
| Data e hora | Ordenação |

O schema deve ser **tolerante a campos extras** (provedores adicionam campos) e **estrito nos campos que você usa**.

## 4. Mensagem normalizada (interna)

O adapter converte o payload do provedor para este formato. O restante do sistema só conhece este.

| Campo | Tipo | Observação |
|---|---|---|
| provider | texto | Qual adapter a produziu |
| externalId | texto | ID no provedor |
| phone | texto | Formato internacional padronizado |
| kind | união discriminada | texto, áudio, outro (v1 só processa texto) |
| text | texto | Presente quando kind é texto |
| receivedAt | data e hora | |

**Por que uma união discriminada em `kind`:** o tipo da mensagem decide quais outros campos existem. Com a união, o compilador obriga você a tratar cada caso, e quando o áudio entrar na v1.1 ele aponta todo lugar que precisa mudar.

## 5. Resultado da qualificação pela IA

Este é o contrato mais importante do projeto. O schema é enviado ao LLM e depois usado para validar a resposta.

| Campo | Tipo | Regras |
|---|---|---|
| intent | enum | Conjunto fechado de intenções administrativas (ex.: informação, preço, pedido de agendamento, outro); valores finais ainda a definir |
| serviceInterest | texto ou nulo | Serviço declarado pelo contato e presente no perfil do negócio, ou nulo; não inferir tratamento a partir de sintomas |
| desiredTimeframe | texto ou nulo | Prazo desejado para atendimento, apenas se informado pelo contato (ex.: "esta semana"); não inferir urgência clínica |
| contactName | texto ou nulo | Só se o cliente informou |
| extraFields | objeto | Campos adicionais definidos pelo perfil do negócio |
| summary | texto | Resumo administrativo, sem diagnóstico ou recomendação clínica; tamanho máximo definido |
| confidence | número | Entre 0 e 1 |
| needsHuman | booleano | A IA pode pedir revisão explícita |

Pontos importantes:

- **Recorte da clínica fictícia (D15):** a IA organiza solicitações para a recepção, sem diagnosticar, indicar tratamento, interpretar exames ou fazer triagem clínica. A demonstração usa dados inteiramente sintéticos.
- **Nulo explícito em vez de inventar:** o schema deve permitir "não sei". Um campo obrigatório sem opção de nulo incentiva o modelo a alucinar.
- **O schema é parcialmente dinâmico.** A lista de serviços e os campos extras vêm do perfil do negócio (D11), então parte do schema é montada em tempo de execução. Isso é um bom exercício: o tipo estático cobre a estrutura fixa e a validação em runtime cobre os valores variáveis.
- **Versionar o schema** junto com o prompt (campo prompt_version em ai_extractions).
- **A confiança informada pelo modelo não é uma probabilidade calibrada.** Trate-a como um sinal auxiliar, não como garantia. Valide também com regras objetivas (campos nulos demais, resumo vazio).

## 6. Perfil do negócio

| Campo | Tipo | Observação |
|---|---|---|
| name | texto | |
| timezone | texto | Fuso do negócio usado para verificar o expediente, independentemente do fuso do servidor (D17) |
| openingHours | lista de faixas | Dia da semana, início e fim, interpretados no fuso do negócio |
| services | lista | Nome e descrição curta |
| menuOptions | lista | Número, rótulo e ação; as opções e seus comportamentos confirmados para a clínica estão no documento 3, seção 6. Os textos finais e dados da clínica ainda serão definidos. |
| qualificationFields | lista | Campos extras que a IA deve tentar extrair |
| messages | objeto | Textos predefinidos: saudação, menu, opção inválida, apresentação de serviços, valores e horários, perguntas após as opções 1 e 2 e aviso fora do expediente com os horários configurados (D17) |

## 7. Contratos da API do painel

| Operação | Entrada | Saída |
|---|---|---|
| Login | E-mail e senha | Credencial de sessão e dados básicos do usuário |
| Listar leads | Filtro de situação (abertos por padrão ou encerrados), estágio e contato opcionais | Lista de cartões (id, contactId, conversationId, nome, estágio, serviço, prazo desejado, indicador Revisar, última atividade) |
| Detalhar lead | ID | Lead completo, resumo, dados extraídos e histórico de mensagens |
| Consultar histórico do contato | ID do contato | Lista dos ciclos de atendimento com IDs da conversa e do lead, quando existir, datas, estado da conversa e resultado do lead; mensagens acessíveis no respectivo detalhe |
| Mover lead | ID, novo estágio, posição | Lead atualizado |
| Assumir lead | ID | Lead atualizado, conversa em atendimento humano |
| Marcar como revisado | ID | Lead sem o indicador Revisar |

Sugestão: **separar o tipo do cartão (leve, para listar) do tipo do detalhe (completo)**. O Kanban carrega dezenas de cartões, então não faz sentido trazer todo o histórico de cada um.

**Atendimento externo (D13):** o detalhe do lead deve disponibilizar o telefone normalizado do contato para o botão **Abrir no WhatsApp**. O botão abre a conversa no WhatsApp; não há operação de envio de mensagens manuais pela API do painel na v1. A operação **Assumir lead** continua responsável por registrar o handoff e silenciar o bot. O histórico retornado inclui apenas as mensagens registradas pelo sistema, sem garantia de sincronização das respostas enviadas diretamente pelo WhatsApp.

**Pedido direto à recepção:** na opção 3 do menu, o card é criado em Novo, com `needsReview = false`, sem chamada à IA. Os contratos de cartão e detalhe devem aceitar ausência de qualificação: intenção, resumo, confiança e demais dados exclusivos da extração ficam nulos quando não disponíveis. A ausência não altera os requisitos do schema de resposta da IA; ela representa um caminho em que a IA não foi chamada.

**Visualização e histórico (D16):** a listagem padrão contém apenas Novo, Qualificado e Em atendimento, com no máximo um card por contato. Ganho e Perdido são consultados pelo filtro de encerrados e pelo histórico do contato. Mover para um desses resultados encerra também a conversa e retira o card da listagem padrão. Novas mensagens reutilizam o atendimento aberto; após o encerramento, iniciam outra conversa, preservando os IDs e resultados anteriores.

## 8. Eventos em tempo real (SSE)

Também uma união discriminada, desta vez pelo nome do evento:

| Evento | Quando | Conteúdo |
|---|---|---|
| lead.created | Lead qualificado, enviado ao fallback ou criado pelo pedido direto à recepção | Cartão do lead |
| lead.updated | Dados ou indicadores mudam | Cartão atualizado |
| lead.moved | Estágio ou posição mudam | ID, estágio e posição novos |
| message.received | Nova mensagem em uma conversa aberta | ID da conversa e mensagem |

O painel trata cada evento por `switch` sobre o nome. Se você esquecer um caso, o compilador avisa (verificação de exaustividade).

Ao aplicar eventos, o painel respeita o filtro atual. Por exemplo, `lead.moved` para Ganho ou Perdido retira o card da visualização de abertos e atualiza a consulta de encerrados; não apaga o registro histórico (D16).

## 9. Formato padrão de erro da API

| Campo | Observação |
|---|---|
| code | Código estável e legível por máquina (ex.: lead_not_found) |
| message | Texto para humanos, sem detalhes internos |
| details | Opcional; erros de validação por campo |
| correlationId | Mesmo identificador dos logs, para rastrear o problema |

## 10. Onde compartilhar tipos entre backend e frontend

A API, o painel e os eventos SSE usam contratos definidos em **`packages/shared` dentro do monorepo**, conforme D19, confirmada em 23/10/2026. `apps/api` e `apps/web` importam os schemas e tipos desse pacote. Assim, alterações podem ser coordenadas no mesmo conjunto de mudanças, e incompatibilidades tipadas podem aparecer na compilação.

O compartilhamento se limita aos contratos: serviços de negócio, repositórios e integrações permanecem no backend. O pacote compartilhado não depende de nenhuma aplicação. O custo é configurar os pacotes e manter suas fronteiras; a validação de dados em runtime continua necessária.

## 11. Onde o TypeScript mais importa neste projeto

- **Fronteiras com `unknown` e schema de runtime**, como descrito na seção 1.
- **Uniões discriminadas** para tipo de mensagem, eventos SSE e resultado de operações.
- **Estados da conversa como tipo fechado**, para que transições inválidas não compilem.
- **Erros tipados**, separando erro de domínio de erro de infraestrutura.
- **Modo `strict` ligado desde o primeiro dia**, sem `any` nas fronteiras.

## 12. Pontos em aberto

- Qual o conjunto final de intenções do enum, e ele varia por negócio?
- Tamanho máximo do resumo e limiar de confiança para acionar a revisão.
