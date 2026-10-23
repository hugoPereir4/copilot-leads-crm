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
| id | identificador | Chave primária |
| phone | texto | Único; guardar em formato internacional padronizado |
| display_name | texto, opcional | Nome que o WhatsApp informa ou que a IA extrai |
| created_at | data e hora | |

### conversations

| Campo | Tipo | Observação |
|---|---|---|
| id | identificador | |
| contact_id | referência | Aponta para contacts |
| status | enum | aguardando_menu, aguardando_detalhes, qualificando, aguardando_humano, em_atendimento_humano, encerrada |
| assigned_user_id | referência, opcional | Atendente responsável |
| last_message_at | data e hora | Registra a última atividade para consulta no painel; não dispara lembretes nem encerramento por inatividade na v1 (D18) |
| created_at, closed_at | data e hora | |

### messages

| Campo | Tipo | Observação |
|---|---|---|
| id | identificador | |
| conversation_id | referência | |
| provider | texto | Ex.: simulador, evolution |
| external_id | texto | ID da mensagem no provedor |
| direction | enum | entrada ou saída |
| sender_type | enum | contato, bot, atendente |
| body | texto | Conteúdo de texto |
| raw_payload | jsonb | Payload original, para depuração |
| created_at | data e hora | |

**Restrição importante:** unicidade em (provider, external_id). É ela que garante a idempotência (D5).

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
| id | identificador | |
| type | texto | Ex.: processar_mensagem |
| message_id | referência | |
| status | enum | pendente, processando, concluido, falhou |
| attempts, max_attempts | número | Controle de novas tentativas |
| run_at | data e hora | Quando pode ser tentado de novo |
| locked_at | data e hora, opcional | Quando um worker o reivindicou |
| last_error | texto, opcional | |
| created_at | data e hora | |

### business_profile e users

- **business_profile:** nome, fuso horário, horário de atendimento, lista de serviços, opções do menu e campos de qualificação. Tudo o que for lista ou estrutura variável pode ficar em jsonb.
- **users:** nome, e-mail único, hash da senha (nunca a senha), data de criação.

### lead_events (opcional)

Tipo do evento (mudança de estágio, assunção, revisão), estágio de origem e destino, usuário responsável e data. Se o tempo apertar, é a primeira tabela a cortar.

## 3. Índices e restrições essenciais

| Onde | O quê | Para quê |
|---|---|---|
| messages | Único em (provider, external_id) | Idempotência |
| contacts | Único em phone | Um registro por número |
| jobs | Índice em (status, run_at) | O worker acha o próximo job rápido |
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
  id uuid [pk]
  phone varchar [not null, unique, note: 'Formato internacional padronizado']
  display_name varchar
  created_at timestamptz [not null, default: `now()`]
}

Table conversations {
  id uuid [pk]
  contact_id uuid [not null]
  status conversation_status [not null]
  assigned_user_id uuid
  last_message_at timestamptz
  created_at timestamptz [not null, default: `now()`]
  closed_at timestamptz

  indexes {
    (contact_id, status)
  }

  Note: 'Estado técnico da conversa. D16: no máximo uma aberta por contato; unicidade parcial definida na migração.'
}

Table messages {
  id uuid [pk]
  conversation_id uuid [not null]
  provider varchar [not null, note: 'Ex.: simulador, evolution']
  external_id varchar [not null, note: 'ID da mensagem no provedor']
  direction message_direction [not null]
  sender_type sender_type [not null]
  body text
  raw_payload jsonb
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (provider, external_id) [unique, note: 'Garante a idempotência']
    (conversation_id, created_at)
  }
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
  id uuid [pk]
  type varchar [not null, note: 'Ex.: processar_mensagem']
  message_id uuid [not null]
  status job_status [not null, default: 'pendente']
  attempts integer [not null, default: 0]
  max_attempts integer [not null, default: 3]
  run_at timestamptz [not null, default: `now()`]
  locked_at timestamptz
  last_error text
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (status, run_at)
  }

  Note: 'Fila transacional de jobs persistida no banco (D4)'
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
