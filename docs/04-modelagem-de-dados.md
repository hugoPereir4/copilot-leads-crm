# Copiloto de Leads WhatsApp — 4. Modelagem de Dados

Documento de planejamento · rascunho de 22/10/2026

Modelo relacional mínimo para sustentar o fluxo do documento 3. Pensado para PostgreSQL, mas os conceitos valem para qualquer banco relacional.

## 1. Entidades e relacionamentos

| Entidade | Papel | Relacionamentos |
|---|---|---|
| business_profile | Configuração do negócio (nome, serviços, horário, menu, campos de qualificação) | Uma linha na v1 |
| users | Atendentes que acessam o painel | 1 usuário : N leads atribuídos |
| contacts | Pessoa que escreve pelo WhatsApp | 1 contato : N conversas ao longo do tempo, no máximo uma aberta |
| conversations | Um ciclo de atendimento com estado próprio | 1 conversa : N mensagens; 1 conversa : no máximo 1 lead, criado conforme o fluxo |
| messages | Cada mensagem recebida ou enviada | N mensagens : 1 conversa |
| leads | Solicitação ou oportunidade, qualificada ou encaminhada diretamente à recepção; aparece como card no Kanban | 1 lead : 1 conversa; N leads : 1 contato |
| ai_extractions | Registro de cada chamada à IA, para auditoria e depuração | N extrações : 1 lead (ou conversa) |
| jobs | Fila de processamento em tabela (D4) | Refere-se a uma mensagem |
| lead_events | Histórico de mudanças do lead (opcional na v1) | N eventos : 1 lead |

## 2. Campos por tabela

### contacts

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid | Chave primária; padrão `gen_random_uuid()` |
| phone | texto | Obrigatório e único; `+` seguido de 2 a 15 dígitos, sem zero inicial |
| display_name | texto, opcional | Nome que o WhatsApp informa ou que a IA extrai |
| created_at | timestamptz | Obrigatório; padrão `now()` |

A migração de `contacts` foi verificada na etapa 4.3 com oito cenários em banco descartável. Uma conferência de leitura encontrou a tabela, suas definições e o registro da migração em `copilot_leads`. A restrição de telefone confere apenas a representação de armazenamento; não normaliza entradas nem valida se o número existe ou pertence a um plano de numeração válido. A normalização será implementada na entrada do futuro caso de uso. O [documento 11](11-etapa-4-migracao-de-contatos.md) explica a implementação e as verificações.

### conversations

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid | Proposta 4.4: chave primária com padrão `gen_random_uuid()` |
| contact_id | uuid | Obrigatório; referência a `contacts`, com exclusão do contato restringida enquanto houver conversas |
| status | texto com CHECK | Proposta 4.4: seis estados previstos na D7; padrão `aguardando_menu` |
| assigned_user_id | referência, opcional, planejada | Será acrescentado junto da tabela `users`; não integra a migração 4.4 |
| last_message_at | timestamptz, opcional | Inicialmente nulo; registra a última atividade para consulta, sem disparar lembretes nem encerramento por inatividade (D18) |
| created_at | timestamptz | Obrigatório, com padrão `now()` |
| closed_at | timestamptz, opcional | Proposta 4.4: obrigatório em `encerrada` e nulo nos demais estados |

A migração de `conversations` está preparada para revisão e foi verificada em banco descartável, sem aplicação no banco do projeto nesta correção. Um índice único parcial em `contact_id` para os estados diferentes de `encerrada` protege a parte da D16 referente a conversas; as encerradas permanecem no histórico. Há também um índice em `(contact_id, status)` para consulta. A atribuição a um atendente dependerá da futura tabela `users`. O [documento 12](12-etapa-4-migracao-de-conversas.md) detalha o SQL, os testes executados e os limites desta etapa.

### messages

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid | Etapa 4.5: obrigatório, chave primária; padrão `gen_random_uuid()` |
| conversation_id | uuid | Obrigatório; referência a `conversations` com `ON DELETE RESTRICT` |
| provider | texto | Obrigatório e não vazio após `btrim`; ex.: simulador, evolution |
| external_id | texto | Obrigatório e não vazio após `btrim`; ID da mensagem no provedor |
| direction | texto com CHECK | Obrigatório; entrada ou saída |
| sender_type | texto com CHECK | Obrigatório; contato, bot ou atendente |
| kind | texto com CHECK | Obrigatório; texto, audio ou outro, conforme o contrato normalizado |
| body | texto, opcional | Conteúdo textual quando disponível; validação do texto processável pertence à entrada |
| raw_payload | jsonb, opcional | Payload original quando disponível, para depuração |
| created_at | timestamptz | Obrigatório; padrão `now()`, instante de registro no sistema |

**Restrição importante:** unicidade em (provider, external_id), inclusive entre conversas diferentes. Essa é a garantia estrutural da D5; o futuro caso de uso ainda precisará reconhecer o reenvio e evitar efeitos duplicados, inclusive jobs. O banco não ignora a violação automaticamente.

A migração da etapa 4.5 está preparada para revisão e passou em dez cenários de integração em banco descartável. `kind` explicita a distinção já prevista no contrato normalizado: mídias podem ser registradas sem serem processadas na V1. Não há inferência do tipo a partir de `body`. O índice em `(conversation_id, created_at)` apoia a consulta do histórico; o campo de data não representa necessariamente o horário informado pelo provedor. O [documento 13](13-etapa-4-migracao-de-mensagens.md) detalha a revisão. A aplicação ao banco do projeto não foi executada nesta entrega.

**Recepção PostgreSQL — etapa 4.8:** o adaptador de persistência resolve contato e conversa na mesma transação da mensagem e de seu eventual job. O payload original é validado como valor JSON antes da conexão e passado como JSON serializado ao JSONB. `messages.created_at` mantém o instante de persistência; `receivedAt`, do contrato interno, atualiza `conversations.last_message_at` apenas quando for mais recente. A data de origem por mensagem continua sem coluna própria. O [documento 16](16-etapa-4-recepcao-postgresql.md) detalha os testes de concorrência e rollback.

### leads

| Campo | Tipo | Observação |
|---|---|---|
| id | identificador | |
| conversation_id | referência | Única: um lead por conversa na v1 |
| contact_id | referência | |
| stage | enum | novo, qualificado, em_atendimento, ganho, perdido |
| needs_review | booleano | Indicador Revisar do fallback humano |
| intent | texto ou enum, opcional | Intenção identificada pela IA; pode ficar sem preenchimento no pedido direto à recepção |
| service_interest | texto, opcional | Serviço de interesse declarado pelo contato, sem indicação de tratamento pela IA |
| desired_timeframe | texto, opcional | Prazo desejado informado pelo contato; não representa urgência clínica (D15) |
| summary | texto, opcional | Resumo administrativo gerado pela IA |
| confidence | número, opcional | Confiança informada pela IA |
| extracted_data | jsonb | Campos extras que variam conforme o negócio |
| assigned_user_id | referência, opcional | |
| position | número | Ordem do card dentro da coluna |
| created_at, updated_at | data e hora | |

O caminho direto à recepção (opção 3) cria o lead em `novo`, com `needs_review = false`, sem criar extração de IA e sem preencher os campos exclusivos da qualificação. O painel deve aceitar a ausência desses dados.

### ai_extractions

| Campo | Tipo | Observação |
|---|---|---|
| id | identificador | |
| conversation_id | referência | |
| model | texto | Modelo usado |
| prompt_version | texto | Versão do prompt e do schema |
| raw_output | jsonb | Saída bruta devolvida pela IA |
| is_valid | booleano | Passou na validação? |
| error | texto, opcional | Motivo da falha |
| latency_ms | número | Tempo de resposta |
| created_at | data e hora | |

### jobs

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid | Obrigatório, chave primária; padrão `gen_random_uuid()` |
| type | texto | Obrigatório e não vazio após `btrim`; ex.: processar_mensagem |
| message_id | uuid | Obrigatório; referência a `messages`, com `ON DELETE RESTRICT` |
| status | texto com CHECK | Obrigatório; pendente, processando, concluido ou falhou; padrão pendente |
| attempts | integer | Obrigatório; padrão 0, entre zero e `max_attempts` |
| max_attempts | integer | Obrigatório e positivo; padrão 3, total de tentativas permitidas |
| run_at | timestamptz | Obrigatório; padrão `now()`, quando pode ser executado |
| locked_at | timestamptz, opcional | Obrigatório em processando e nulo nos demais estados; registro da reivindicação |
| last_error | texto, opcional | Último erro; a futura implementação deve guardar uma descrição sanitizada |
| created_at | timestamptz | Obrigatório; padrão `now()` |

A migração 4.6 está preparada para revisão e passou em onze cenários em banco descartável. A unicidade de `(type, message_id)` mantém um job por tarefa e mensagem, inclusive depois de concluído; novas tentativas atualizam o mesmo job. Outro tipo de tarefa pode referenciar a mesma mensagem. O índice em `(status, run_at)` apoia a busca por trabalhos disponíveis.

Essas restrições não implementam worker, agendamento, backoff ou recuperação de jobs interrompidos. `locked_at` é metadado persistido, não um bloqueio de linha. A reivindicação transacional e a gravação atômica de mensagem e job pertencem aos fluxos das etapas 4.10 e 4.8, descritos a seguir. O [documento 14](14-etapa-4-migracao-de-jobs.md) registra as garantias e a validação da migração na entrega 4.6, quando ela ainda não havia sido aplicada ao banco do projeto.

A etapa 4.8 implementa a gravação atômica: a decisão `enqueueProcessing` vem do caso de uso; quando verdadeira, a infraestrutura insere `processar_mensagem` antes do commit da mensagem. Os testes provocam falha nessa inserção e verificam rollback das quatro tabelas e da última atividade de conversa já existente. O job fica pendente até uma reserva posterior.

A etapa 4.10 implementa a reserva: o caso de uso solicita `processar_mensagem`, e a infraestrutura seleciona um job pendente cujo `run_at` chegou e cujo contador permite outra tentativa. A seleção com `FOR UPDATE SKIP LOCKED` e a atualização para `processando`, com incremento de `attempts` e preenchimento de `locked_at`, fazem parte de uma única instrução SQL e sua transação implícita. A ordenação usa `run_at`, `created_at` e `id` entre candidatos desbloqueados. Nenhuma alteração de estrutura foi necessária; o módulo ainda não está ligado ao consumo automático. O [documento 18](18-etapa-4-reivindicacao-de-jobs.md) apresenta o fluxo de revisão e os testes.

A etapa 4.11 acrescenta conclusão e registro de falha com updates condicionados ao ID, estado `processando` e contador da tentativa atual. Sucesso limpa `locked_at` e `last_error`; falha transitória com saldo reagenda `run_at` pelo relógio do banco; falha definitiva ou limite esgotado marca `falhou`. Finalização e reagendamento não incrementam ou zeram `attempts`, e `last_error` recebe somente códigos controlados. Tentativas antigas não sobrescrevem reservas posteriores. Nenhuma coluna ou restrição precisou mudar. O [documento 19](19-etapa-4-finalizacao-de-jobs.md) apresenta as garantias verificadas.

A etapa 4.12 usa as colunas existentes para recuperar `processando` com `locked_at` expirado. A seleção limitada com `FOR UPDATE SKIP LOCKED` e o update pertencem à mesma instrução. Com saldo, muda para `pendente` e define `run_at` pelo relógio do banco; sem saldo, marca `falhou` preservando o agendamento. Ambos limpam `locked_at`, registram `processing_reservation_expired` e mantêm `attempts`. O prazo inicial é de 120 segundos, com lote de 100 no caso de uso. Nenhuma migração foi necessária. Execução periódica, consumo automático e idempotência dos efeitos continuam pendentes. O [documento 20](20-etapa-4-recuperacao-de-jobs.md) apresenta a ordem de revisão e os testes.

A etapa 4.13 lê o contexto pelo ID de `messages`, seguindo `conversation_id` e depois `contact_id` em um único SELECT. Não escolhe a conversa aberta mais recente e não altera nenhuma tabela. `messages.body` e `contacts.display_name` preservam nulos; `messages.created_at` continua sendo a data de persistência, sem inferir a data de origem do provedor. O schema Zod valida a representação interna da leitura. Nenhuma mudança de estrutura foi necessária. O [documento 21](21-etapa-4-contexto-da-mensagem.md) detalha os campos e o comportamento concorrente.

### business_profile e users

- **business_profile:** nome, fuso horário, horário de atendimento, lista de serviços, opções do menu e campos de qualificação. Tudo o que for lista ou estrutura variável pode ficar em jsonb.
- **users:** nome, e-mail único, hash da senha (nunca a senha), data de criação.

### lead_events (opcional)

Tipo do evento (mudança de estágio, assunção, revisão), estágio de origem e destino, usuário responsável e data. Se o tempo apertar, é a primeira tabela a cortar.

## 3. Índices e restrições essenciais

| Onde | O quê | Para quê |
|---|---|---|
| messages | Único em (provider, external_id) | Idempotência |
| messages | Índice em (conversation_id, created_at) | Consultar o histórico de uma conversa |
| contacts | Único em phone | Um registro por número |
| jobs | Índice em (status, run_at) | O worker acha o próximo job rápido |
| jobs | Único em (type, message_id) | Um job por tarefa e mensagem; reutilizar o mesmo registro nas tentativas |
| leads | Índice em (stage, position) | Montar as colunas do Kanban |
| leads | Único em conversation_id | Um lead por conversa |
| conversations | Índice em (contact_id, status) | Achar a conversa ativa de um contato |
| conversations | Unicidade parcial em contact_id quando status é diferente de encerrada | Garantir no máximo uma conversa aberta por contato, inclusive sob concorrência (D16) |
| leads | Unicidade parcial em contact_id quando stage é novo, qualificado ou em_atendimento | Garantir no máximo um lead aberto por contato sem impedir vários encerrados (D16) |

Mover o lead para `ganho` ou `perdido` e encerrar sua conversa deve ocorrer na mesma transação. Um retorno posterior cria outra conversa no mesmo contato, sem alterar o resultado anterior. Os índices parciais acima serão definidos nas migrações; o DBML abaixo é uma representação simplificada e não os expressa.

## 4. Por que o modelo é assim

- **contacts separado de leads:** a mesma pessoa pode voltar meses depois. O contato é reutilizado entre os ciclos de atendimento; cada lead é uma oportunidade específica. Há no máximo um lead aberto por contato, e os encerrados continuam no histórico (D16).
- **conversations separado de leads:** a conversa tem um estado técnico (quem está falando agora), enquanto o lead tem um estágio comercial (em que ponto do funil está). São dois conceitos diferentes que mudam por motivos diferentes.
- **Campos centrais como colunas e o restante em jsonb:** intenção, serviço e prazo desejado aparecem no Kanban e ficam em colunas próprias. Os campos que variam por negócio (D11) vão em extracted_data, sem precisar de migração a cada nicho novo.
- **ai_extractions separado:** o lead guarda a versão validada e atual. O registro de cada chamada à IA, com saída bruta e versão do prompt, é o que permite depurar e comparar prompts.
- **raw_payload em messages:** quando o provedor mudar o formato, você terá o original para investigar.
- **Enums para estados:** tornam estados inválidos impossíveis de gravar. Pode ser enum nativo do PostgreSQL ou texto com restrição de valores.

## 5. Pontos em aberto

- Política de retenção: por quanto tempo guardar mensagens e o payload bruto (o telefone é dado pessoal).
- A ordenação dos cards usa números fracionários ou uma lista reordenada a cada movimento?
- Vale incluir lead_events já na v1?

## 6. Código DBML (para colar no dbdiagram.io)

Cole o bloco abaixo em https://dbdiagram.io/d para ver o diagrama.

```dbml
// Copiloto de Leads WhatsApp - Modelagem de dados (v1)

Enum conversation_status {
  aguardando_menu
  aguardando_detalhes
  qualificando
  aguardando_humano
  em_atendimento_humano
  encerrada
}

Enum lead_stage {
  novo
  qualificado
  em_atendimento
  ganho
  perdido
}

Enum message_direction {
  entrada
  saida
}

Enum sender_type {
  contato
  bot
  atendente
}

Enum message_kind {
  texto
  audio
  outro
}

Enum job_status {
  pendente
  processando
  concluido
  falhou
}

Table business_profile {
  id uuid [pk]
  name varchar [not null]
  timezone varchar [not null]
  opening_hours jsonb
  services jsonb
  menu_options jsonb
  qualification_fields jsonb
  messages jsonb [note: 'Textos pré-definidos: saudação, menu, opção inválida']
  created_at timestamptz [not null, default: `now()`]

  Note: 'Uma linha na v1 (single-tenant). Configuração do negócio como dados.'
}

Table users {
  id uuid [pk]
  name varchar [not null]
  email varchar [not null, unique]
  password_hash varchar [not null]
  created_at timestamptz [not null, default: `now()`]

  Note: 'Atendentes do painel'
}

Table contacts {
  id uuid [pk, default: `gen_random_uuid()`]
  phone text [not null, unique, note: '+ seguido de 2 a 15 dígitos, sem zero inicial; CHECK na migração SQL']
  display_name text
  created_at timestamptz [not null, default: `now()`]
}

Table conversations {
  id uuid [pk, default: `gen_random_uuid()`]
  contact_id uuid [not null]
  status conversation_status [not null, default: 'aguardando_menu', note: 'Enum conceitual; proposta SQL 4.4 usa text com CHECK']
  assigned_user_id uuid [note: 'Planejado para a entrega de users; ausente na migração 4.4']
  last_message_at timestamptz
  created_at timestamptz [not null, default: `now()`]
  closed_at timestamptz

  indexes {
    (contact_id, status)
  }

  Note: 'Proposta 4.4 em revisão. D16: no máximo uma aberta por contato; índice parcial e coerência de closed_at definidos no SQL. assigned_user_id é futuro.'
}

Table messages {
  id uuid [pk, default: `gen_random_uuid()`]
  conversation_id uuid [not null]
  provider varchar [not null, note: 'Ex.: simulador, evolution']
  external_id varchar [not null, note: 'ID da mensagem no provedor']
  direction message_direction [not null]
  sender_type sender_type [not null]
  kind message_kind [not null, note: 'Etapa 4.5 usa text com CHECK para tipo, direção e remetente']
  body text
  raw_payload jsonb
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (provider, external_id) [unique, note: 'Garante a idempotência']
    (conversation_id, created_at)
  }

  Note: 'Etapa 4.5 em revisão. FK com ON DELETE RESTRICT; provider e external_id não vazios após btrim. created_at registra a persistência, não o horário do provedor.'
}

Table leads {
  id uuid [pk]
  conversation_id uuid [not null, unique]
  contact_id uuid [not null]
  stage lead_stage [not null, default: 'novo']
  needs_review boolean [not null, default: false, note: 'Indicador Revisar (fallback humano)']
  intent varchar
  service_interest varchar
  desired_timeframe text [note: 'Prazo desejado informado pelo contato; não representa urgência clínica (D15)']
  summary text
  confidence numeric(3,2)
  extracted_data jsonb [note: 'Campos extras que variam por negócio']
  assigned_user_id uuid
  position numeric [not null, default: 0, note: 'Ordem do card dentro da coluna']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    (stage, position)
  }

  Note: 'Estágio comercial do funil. D16: no máximo um lead aberto por contato; encerrados ficam no histórico e no filtro de encerrados.'
}

Table ai_extractions {
  id uuid [pk]
  conversation_id uuid [not null]
  lead_id uuid
  model varchar [not null]
  prompt_version varchar [not null]
  raw_output jsonb
  is_valid boolean [not null]
  error text
  latency_ms integer
  created_at timestamptz [not null, default: `now()`]

  Note: 'Auditoria de cada chamada à IA'
}

Table jobs {
  id uuid [pk, default: `gen_random_uuid()`]
  type text [not null, note: 'Ex.: processar_mensagem; não vazio após btrim']
  message_id uuid [not null]
  status job_status [not null, default: 'pendente', note: 'SQL 4.6 usa text com CHECK']
  attempts integer [not null, default: 0, note: 'Entre zero e max_attempts']
  max_attempts integer [not null, default: 3, note: 'Positivo; total de tentativas']
  run_at timestamptz [not null, default: `now()`]
  locked_at timestamptz
  last_error text
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (status, run_at)
    (type, message_id) [unique]
  }

  Note: 'Etapa 4.6 em revisão. FK com ON DELETE RESTRICT. locked_at preenchido apenas em processando. Worker e gravação conjunta com mensagem ainda pendentes (D4).'
}

Table lead_events {
  id uuid [pk]
  lead_id uuid [not null]
  user_id uuid
  type varchar [not null, note: 'Ex.: mudanca_estagio, assuncao, revisao']
  from_stage lead_stage
  to_stage lead_stage
  created_at timestamptz [not null, default: `now()`]

  Note: 'Opcional na v1: histórico de mudanças do lead'
}

Ref: conversations.contact_id > contacts.id
Ref: conversations.assigned_user_id > users.id
Ref: messages.conversation_id > conversations.id
Ref: leads.conversation_id - conversations.id
Ref: leads.contact_id > contacts.id
Ref: leads.assigned_user_id > users.id
Ref: ai_extractions.conversation_id > conversations.id
Ref: ai_extractions.lead_id > leads.id
Ref: jobs.message_id > messages.id
Ref: lead_events.lead_id > leads.id
Ref: lead_events.user_id > users.id
```
