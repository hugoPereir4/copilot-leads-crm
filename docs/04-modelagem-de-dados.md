# Copiloto de Leads WhatsApp — 4. Modelagem de Dados

Documento de planejamento · rascunho de 22/10/2026

Modelo relacional mínimo para sustentar o fluxo do documento 3. Pensado para PostgreSQL, mas os conceitos valem para qualquer banco relacional.

## 1. Entidades e relacionamentos

| Entidade | Papel | Relacionamentos |
|---|---|---|
| business_profile | Configuração do negócio (nome, serviços, horário, menu, campos de qualificação) | Perfil único; JSON inicial na etapa 4.14, tabela ainda planejada |
| users (previsão, sem migração) | Proposta antiga de usuários do painel, com atribuição de leads. A autenticação implementada usa `attendants` (D23) | Previsto: 1 usuário : N leads atribuídos |
| contacts | Pessoa que escreve pelo WhatsApp | 1 contato : N conversas ao longo do tempo, no máximo uma aberta |
| conversations | Um ciclo de atendimento com estado próprio | 1 conversa : N mensagens; 1 conversa : no máximo 1 lead, criado conforme o fluxo |
| messages | Cada mensagem recebida ou enviada | N mensagens : 1 conversa |
| leads | Solicitação ou oportunidade, qualificada ou encaminhada diretamente à recepção; aparece como card no Kanban | 1 lead : 1 conversa; N leads : 1 contato |
| ai_extractions | Registro de cada chamada à IA, para auditoria e depuração | N extrações : 1 lead (ou conversa) |
| jobs | Fila de processamento em tabela (D4) | Refere-se a uma mensagem |
| response_plans (migração 4.18) | Intenção durável de resposta, verificada em banco descartável | No máximo um plano por mensagem; abertura única e um pendente por conversa |
| response_blocks (migração 4.18) | Textos e progresso de envio, verificados em banco descartável | N blocos : 1 plano; posição positiva e única no plano |
| lead_events | Histórico de mudanças do lead (opcional na v1) | N eventos : 1 lead |
| attendants | Atendentes que entram no painel (D23); criados pela linha de comando | 1 atendente : N sessões. Ainda sem vínculo com leads (sem registro de autoria) |
| attendant_sessions | Sessões de login no servidor; o banco guarda só o SHA-256 do token | N sessões : 1 atendente; apagadas em cascata com o atendente |

## 2. Campos por tabela

### contacts

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid | Chave primária; padrão `gen_random_uuid()` |
| phone | texto | Obrigatório e único; `+` seguido de 2 a 15 dígitos, sem zero inicial |
| display_name | texto, opcional | Nome de perfil informado pelo provedor (`profileName` no simulador). Finalidade: identificar o lead no painel. Cada mensagem nova que traz o nome o sobrescreve; duplicatas, ecos próprios e mensagens sem nome não o alteram. Não é extraído pela IA nem enviado a ela |
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
| id | uuid | PK; padrão gen_random_uuid() |
| conversation_id | uuid | Obrigatório e único: um lead por conversa |
| contact_id | uuid | FK composta com conversation_id garante o contato da conversa |
| stage | text com CHECK | novo, qualificado, em_atendimento, ganho, perdido; padrão novo |
| needs_review | boolean | Obrigatório; padrão false |
| summary | text, opcional | Resumo administrativo construído pelo backend com os campos comprovados |
| qualification | jsonb, opcional | Intenção, serviço, período, resumo, revisão, origem e status; validado por Zod e CHECK estrutural |
| created_at, updated_at | timestamptz | Obrigatórios; padrão now() |

A migração `1794873600000_create_leads.sql` implementa o lead inicial; `1794956400000_create_qualification_runs.sql` acrescenta `qualification` e a reserva rastreável por mensagem. A nova migração foi aplicada apenas nos bancos descartáveis. Intenção, serviço e preferência estão no JSON; atribuição e ordenação manual permanecem futuras. Unicidade por conversa/contato aberto e índices anteriores são preservados.

### qualification_runs

Uma reserva por `message_id` (PK), vinculada por FKs compostas à conversa da mensagem e ao par job/mensagem. Guarda `reserved_attempt`, `source`, `status` (`processando`, `concluida`, `descartada`), `result` JSON validado, `error_code` técnico e datas `created_at`/`finished_at`. Não armazena prompt ou resposta bruta. O lead recebe somente o resultado permitido após revalidar os locks; a reserva interrompida vira revisão sem repetir a API. [Guia](32-qualificacao-de-leads.md).

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

### response_plans e response_blocks — etapas 4.17 a 4.20

O primeiro recorte, na etapa 4.17, implementou somente o contrato do rascunho e a preparação pela aplicação, quando as tabelas ainda não existiam. `response_plans` vincula mensagem, conversa e job de origem, preservando ação, estado esperado/próximo, referência temporal e status do plano. `response_blocks` guarda posição, texto e progresso de cada bloco, com possível referência à mensagem de saída confirmada.

A proposta exige unicidade da mensagem de origem, da abertura por conversa e de um plano pendente por conversa; posições são únicas dentro do plano. O vínculo mensagem/conversa e job/mensagem também precisa de proteção estrutural. Gravar plano e todos os blocos exige uma transação. A sequência completa dos blocos não será tratada como um `CHECK` simples entre linhas.

Preparação não altera o estado da conversa ou confirma o envio. Abertura pendente, enviada e cancelada terão tratamentos distintos na futura orquestração. Cancelar não apaga o histórico ou autoriza segunda abertura automática. O [documento 25](25-etapa-4-contrato-do-plano-de-resposta.md) descreve os campos, as restrições propostas e as provas de concorrência/rollback da porta ainda pendentes. Na etapa 4.17, nenhuma migração desse modelo havia sido criada.

**Migração da etapa 4.18:** o SQL das duas tabelas foi aplicado/revertido em banco descartável e depois aplicado pelo autor ao banco local do projeto. As chaves únicas `(id, conversation_id)` de `messages` e `(id, message_id)` de `jobs` apoiam as FKs compostas da origem. O plano tem também uma chave `(id, conversation_id)`; os blocos acrescentam `conversation_id` para conferir tanto a conversa do plano quanto a da mensagem confirmada. O status do plano/bloco e as respectivas datas têm checks locais. O [documento 26](26-etapa-4-migracao-dos-planos-de-resposta.md) detalha os campos e a reversão.

**Persistência da etapa 4.19:** o adapter valida a lista não vazia/consecutiva e grava plano/blocos na mesma transação, sob proteção da tentativa e da conversa. Reconhece o original sem sobrescrever conteúdo, confere origem/elegibilidade e distingue abertura pendente, enviada ou cancelada. Criar não confirma envio nem altera o estado da conversa. A coerência futura entre plano terminado e todos os blocos continua responsabilidade da confirmação coordenada; SQL direto não torna os textos imutáveis. O [documento 27](27-etapa-4-preparacao-postgresql-do-plano.md) apresenta as garantias e a revisão.

**Leitura da etapa 4.20:** o reader consulta o plano por `source_message_id`, com todos os blocos ordenados por `position` e confirmações opcionais. O contrato de leitura valida representação, sequência e coerência de status/datas; não acrescenta colunas, índices ou constraints. Incoerências permitidas pelo SQL entre linhas são rejeitadas na leitura, sem reparo automático. A confirmação futura deverá mantê-las coerentes atomicamente. O [documento 28](28-etapa-4-leitura-do-plano-de-resposta.md) apresenta as regras. O bloco DBML da seção 6 permanece inalterado.

### business_profile e users

- **business_profile:** a etapa 4.14 escolhe inicialmente um JSON versionado para nome, fuso, moeda, faixas de atendimento, serviços, valores, opções do menu e textos-base. O schema exige preços inteiros em centavos ou nulos, horários válidos sem sobreposição e IDs/opções únicos. Os campos extras de qualificação continuam planejados para a integração de IA. Não há migração dessa tabela; o diagrama relacional abaixo continua sendo uma proposta futura para esse perfil. O [documento 22](22-etapa-4-perfil-do-negocio.md) detalha a implementação de arquivo e a porta de leitura.
- **users (previsão, sem migração):** nome, e-mail único, hash da senha (nunca a senha), data de criação. Não existe migração de `users`; o login implementado usa `attendants` e `attendant_sessions` (seção abaixo e D23).

### attendants e attendant_sessions — login de atendentes

Migração `1795046400000_create_attendants.sql`. Detalhes no [documento 34](34-login-de-atendentes.md).

**attendants**

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid | Chave primária `attendants_pkey`; padrão `gen_random_uuid()` |
| username | text | Obrigatório e único (`attendants_username_key`); CHECK `^[a-z0-9._-]{3,32}$` |
| display_name | text | Obrigatório; CHECK de 1 a 80 caracteres depois de `btrim` |
| password_hash | text | Obrigatório; formato `scrypt$logN$r$p$salt$hash` (base64url), nunca a senha |
| created_at, updated_at | timestamptz | Obrigatórios; padrão `now()` |

**attendant_sessions**

| Campo | Tipo | Observação |
|---|---|---|
| token_hash | bytea | Chave primária; SHA-256 do token do cookie, CHECK de 32 bytes |
| attendant_id | uuid | Obrigatório; FK para `attendants` com `ON DELETE CASCADE`; índice `attendant_sessions_attendant_id_idx` |
| created_at | timestamptz | Obrigatório; padrão `now()` |
| expires_at | timestamptz | Obrigatório; CHECK `expires_at > created_at` |

Não há vínculo entre atendentes e leads ou conversas: assumir e encerrar ainda não registram quem fez a ação (backlog técnico, item 6b).

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
| leads | Índice em (stage, created_at); posição manual futura | Consultar as colunas do Kanban no MVP |
| leads | Único em conversation_id | Um lead por conversa |
| conversations | Índice em (contact_id, status) | Achar a conversa ativa de um contato |
| conversations | Unicidade parcial em contact_id quando status é diferente de encerrada | Garantir no máximo uma conversa aberta por contato, inclusive sob concorrência (D16) |
| leads | Unicidade parcial em contact_id quando stage é novo, qualificado ou em_atendimento | Garantir no máximo um lead aberto por contato sem impedir vários encerrados (D16) |

Mover o lead para `ganho` ou `perdido` e encerrar sua conversa ocorre na mesma transação na entrega de [encerramento](31-encerramento-de-leads.md), preenchendo `closed_at` e preservando o resultado na repetição. Um retorno posterior cria outra conversa no mesmo contato, sem alterar o resultado anterior. As migrações de conversas e leads já definem os índices únicos parciais que impedem múltiplos registros abertos por contato; o DBML abaixo registra seus predicados em notas. Não foi necessária nova migração.

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

A estrutura de leads abaixo pertence à nova migração do MVP; o banco principal só a receberá após revisão.

## 6. Código DBML (para colar no dbdiagram.io)

Atualizado em 16/11/2026. Copie **todo o bloco abaixo** para o [dbdiagram.io](https://dbdiagram.io/d).

- **Implementadas nas migrações:** `contacts`, `conversations`, `messages`, `jobs`, `response_plans`, `response_blocks`, `leads`, `qualification_runs`, `attendants` e `attendant_sessions`. As oito migrações de `apps/api/migrations` são a fonte de verdade. Cada ambiente aplica as pendentes com `npm run db:migrate`; o repositório não registra quais já foram aplicadas em cada banco.
- **Propostas futuras, sem migração:** `business_profile`, `users` (previsão; o login implementado usa `attendants`), `ai_extractions` e `lead_events`. Seus campos e relacionamentos conceituais já documentados foram preservados em outro grupo, com notas explícitas. O perfil atual continua em JSON; `lead_events` é opcional na V1.
- `conversations.assigned_user_id` é uma proposta futura e não aparece na tabela implementada nem como FK no diagrama. Não existe FK direta dos planos/blocos para `conversations`: o vínculo já é garantido pelas FKs compostas que passam por `messages` e pelo plano. Não foi acrescentada uma referência SQL fictícia.
- O DBML representa nativamente as sete FKs compostas, as chaves compostas e os `CHECK` nomeados. As expressões PostgreSQL dos checks permanecem na notação de expressão, e as notas explicam suas consequências; o parser DBML não executa essas validações. Os quatro índices únicos parciais ficam **somente em notas com nome e predicado**, pois não se deve transformar uma unicidade condicional em global.
- Este bloco serve à visualização e contém propostas futuras; não deve ser exportado e aplicado como substituto das migrações. A tabela interna `pgmigrations`, mantida pelo migrador, fica fora do modelo de domínio.

Sintaxe de referência: [DBML — checks, índices e FKs compostas](https://dbml.dbdiagram.io/docs/) e [grupos e notas](https://dbml.dbdiagram.io/syntax/enrichment-visualization/).

```dbml
// Copiloto de Leads WhatsApp — estrutura implementada e propostas futuras.
// Tabelas sem prefixo pertencem ao schema public.
// Fonte de verdade do grupo implementado: oito migrações SQL, incluindo qualificação e atendentes.
// Os grupos abaixo são apenas visuais; não criam schemas ou tabelas adicionais.

Project copiloto_leads_whatsapp {
  database_type: 'PostgreSQL'
  Note: '''
  MIGRAÇÕES IMPLEMENTADAS: contacts, conversations, messages, jobs, response_plans, response_blocks, leads, qualification_runs, attendants, attendant_sessions.
  PLANEJADAS: business_profile, users, ai_extractions, lead_events.
  Os índices únicos parciais estão descritos nas notas, sem índices globais substitutos.
  Checks são expressões PostgreSQL; DBML não os executa.
  As sete FKs compostas são declaradas uma vez, sem refs simples duplicadas.
  Não usar este diagrama misto para migrar o banco.
  '''
}

// ==================== IMPLEMENTADAS NO POSTGRESQL ====================

Table contacts {
  id uuid [pk, not null, default: `gen_random_uuid()`]
  phone text [not null]
  display_name text
  created_at timestamptz [not null, default: `now()`]

  indexes {
    phone [unique, name: 'contacts_phone_key']
  }

  checks {
    `phone ~ '^[+][1-9][0-9]{1,14}$'` [name: 'contacts_phone_format_check']
  }

  Note: 'IMPLEMENTADA — etapa 4.3. PK contacts_pkey. CHECK: + seguido de 2 a 15 dígitos, sem zero inicial; não prova que o telefone existe.'
}

Table conversations {
  id uuid [pk, not null, default: `gen_random_uuid()`]
  contact_id uuid [not null]
  status text [not null, default: 'aguardando_menu']
  last_message_at timestamptz
  created_at timestamptz [not null, default: `now()`]
  closed_at timestamptz

  indexes {
    (contact_id, status) [name: 'conversations_contact_status_idx']
    (id, contact_id) [unique, name: 'conversations_id_contact_id_key']
  }

  checks {
    `status IN ('aguardando_menu', 'aguardando_detalhes', 'qualificando', 'aguardando_humano', 'em_atendimento_humano', 'encerrada')` [name: 'conversations_status_check']
    `(status = 'encerrada' AND closed_at IS NOT NULL) OR (status <> 'encerrada' AND closed_at IS NULL)` [name: 'conversations_closed_at_status_check']
  }

  Note: '''
  IMPLEMENTADA — etapa 4.4. PK conversations_pkey. Estado é text com CHECK, não enum nativo.
  ÍNDICE ÚNICO PARCIAL, somente anotado: conversations_one_open_per_contact_idx
  ON (contact_id) WHERE status <> 'encerrada'. Garante no máximo uma conversa aberta por contato.
  CHECK: closed_at obrigatório em encerrada e nulo nos demais estados.
  assigned_user_id e a FK para users são futuros; não integram esta tabela.
  '''
}

Table messages {
  id uuid [pk, not null, default: `gen_random_uuid()`]
  conversation_id uuid [not null]
  provider text [not null, note: 'Provedor; não vazio após btrim']
  external_id text [not null, note: 'ID no provedor; não vazio após btrim']
  direction text [not null]
  sender_type text [not null]
  kind text [not null]
  body text
  raw_payload jsonb
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (provider, external_id) [unique, name: 'messages_provider_external_id_key']
    (conversation_id, created_at) [name: 'messages_conversation_created_at_idx']
    (id, conversation_id) [unique, name: 'messages_id_conversation_id_key']
  }

  checks {
    `btrim(provider) <> ''` [name: 'messages_provider_not_blank_check']
    `btrim(external_id) <> ''` [name: 'messages_external_id_not_blank_check']
    `direction IN ('entrada', 'saida')` [name: 'messages_direction_check']
    `sender_type IN ('contato', 'bot', 'atendente')` [name: 'messages_sender_type_check']
    `kind IN ('texto', 'audio', 'outro')` [name: 'messages_kind_check']
  }

  Note: '''
  IMPLEMENTADA — etapa 4.5, com chave de apoio acrescentada na 4.18. PK messages_pkey.
  Direção, remetente e tipo são text com CHECK. created_at registra a persistência, não o horário do provedor.
  UNIQUE (id, conversation_id) apoia as FKs compostas da origem e da confirmação dos blocos.
  '''
}

Table jobs {
  id uuid [pk, not null, default: `gen_random_uuid()`]
  type text [not null, note: 'Ex.: processar_mensagem; não vazio após btrim']
  message_id uuid [not null]
  status text [not null, default: 'pendente']
  attempts integer [not null, default: 0]
  max_attempts integer [not null, default: 3]
  run_at timestamptz [not null, default: `now()`]
  locked_at timestamptz
  last_error text
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (type, message_id) [unique, name: 'jobs_type_message_id_key']
    (status, run_at) [name: 'jobs_status_run_at_idx']
    (id, message_id) [unique, name: 'jobs_id_message_id_key']
  }

  checks {
    `btrim(type) <> ''` [name: 'jobs_type_not_blank_check']
    `status IN ('pendente', 'processando', 'concluido', 'falhou')` [name: 'jobs_status_check']
    `max_attempts > 0` [name: 'jobs_max_attempts_check']
    `attempts >= 0 AND attempts <= max_attempts` [name: 'jobs_attempts_check']
    `(status = 'processando' AND locked_at IS NOT NULL) OR (status <> 'processando' AND locked_at IS NULL)` [name: 'jobs_locked_at_status_check']
  }

  Note: '''
  IMPLEMENTADA — etapa 4.6, com chave de apoio acrescentada na 4.18. PK jobs_pkey.
  Status é text com CHECK. locked_at existe apenas em processando e não é um lock de linha.
  UNIQUE (type, message_id) mantém um job por tarefa/mensagem; UNIQUE (id, message_id) apoia a FK composta do plano.
  '''
}

Table response_plans {
  id uuid [pk, not null, default: `gen_random_uuid()`]
  conversation_id uuid [not null]
  source_message_id uuid [not null]
  source_job_id uuid [not null]
  action text [not null]
  expected_status text [not null]
  next_status text [not null]
  reference_at timestamptz [not null]
  status text [not null, default: 'pendente']
  created_at timestamptz [not null, default: `now()`]
  finished_at timestamptz

  indexes {
    (id, conversation_id) [unique, name: 'response_plans_id_conversation_id_key']
    source_message_id [unique, name: 'response_plans_source_message_id_key']
  }

  checks {
    `expected_status = 'aguardando_menu'` [name: 'response_plans_expected_status_check']
    `(action IN ('enviar_abertura', 'reapresentar_menu') AND next_status = 'aguardando_menu') OR (action IN ('informar_servicos', 'informar_valores_horarios') AND next_status = 'aguardando_detalhes')` [name: 'response_plans_action_next_status_check']
    `status IN ('pendente', 'enviado', 'cancelado')` [name: 'response_plans_status_check']
    `isfinite(reference_at) AND isfinite(created_at)` [name: 'response_plans_finite_dates_check']
    `(status = 'pendente' AND finished_at IS NULL) OR (status <> 'pendente' AND finished_at IS NOT NULL)` [name: 'response_plans_finished_status_check']
    `finished_at IS NULL OR (isfinite(finished_at) AND finished_at >= created_at)` [name: 'response_plans_finished_at_check']
  }

  Note: '''
  IMPLEMENTADA — etapa 4.18. PK response_plans_pkey. Um plano por mensagem, inclusive enviado/cancelado.
  ÍNDICES ÚNICOS PARCIAIS, somente anotados:
  response_plans_opening_conversation_key ON (conversation_id) WHERE action = 'enviar_abertura'.
  response_plans_pending_conversation_key ON (conversation_id) WHERE status = 'pendente'.
  Abertura permanece única após envio/cancelamento; no máximo um plano pendente por conversa.
  FKs COMPOSTAS, declaradas abaixo: (source_message_id, conversation_id) referencia messages;
  (source_job_id, source_message_id) referencia jobs. Conferem também a correspondência das origens.
  A conversa é vinculada por messages; não há FK direta para conversations.
  CHECKs ligam ação/próximo estado e status/data de término; datas devem ser finitas e término não anterior à criação.
  Não há CHECK entre linhas que exija blocos ou que confira todos os blocos ao terminar o plano.
  '''
}

Table response_blocks {
  plan_id uuid [not null]
  conversation_id uuid [not null]
  position integer [not null]
  text text [not null]
  status text [not null, default: 'pendente']
  sent_message_id uuid
  sent_at timestamptz

  indexes {
    (plan_id, position) [pk, name: 'response_blocks_pkey']
    sent_message_id [unique, name: 'response_blocks_sent_message_id_key']
  }

  checks {
    `position > 0` [name: 'response_blocks_position_check']
    `text ~ '[^[:space:]]'` [name: 'response_blocks_text_not_blank_check']
    `status IN ('pendente', 'enviado', 'cancelado')` [name: 'response_blocks_status_check']
    `(status = 'enviado' AND sent_message_id IS NOT NULL AND sent_at IS NOT NULL) OR (status <> 'enviado' AND sent_message_id IS NULL AND sent_at IS NULL)` [name: 'response_blocks_sent_status_check']
    `sent_at IS NULL OR isfinite(sent_at)` [name: 'response_blocks_sent_at_check']
  }

  Note: '''
  IMPLEMENTADA — etapa 4.18. Não possui coluna id: a PK é (plan_id, position).
  FKs COMPOSTAS, declaradas abaixo: (plan_id, conversation_id) referencia response_plans;
  (sent_message_id, conversation_id) referencia messages e impede confirmação em outra conversa.
  A FK opcional de confirmação usa MATCH SIMPLE padrão: sent_message_id nulo não exige correspondência.
  UNIQUE (sent_message_id) permite vários NULLs; uma mensagem confirmada não pode ser usada em dois blocos.
  CHECKs: posição positiva, texto com caractere fora de espaços POSIX e data finita quando informada.
  Enviado exige mensagem/data; pendente e cancelado exigem ambas nulas.
  Contiguidade 1…N, ordem de envio e direção/remetente da mensagem confirmada não são garantidos por esses CHECKs.
  '''
}

Table leads {
  id uuid [pk, not null, default: `gen_random_uuid()`]
  conversation_id uuid [not null]
  contact_id uuid [not null]
  stage text [not null, default: 'novo']
  needs_review boolean [not null, default: false]
  summary text
  qualification jsonb [note: 'Resultado administrativo validado. NULL em leads sem qualificação.']
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
  indexes {
    conversation_id [unique, name: 'leads_conversation_id_key']
    (stage, created_at) [name: 'leads_stage_created_at_idx']
  }
  checks {
    `stage IN ('novo', 'qualificado', 'em_atendimento', 'ganho', 'perdido')` [name: 'leads_stage_check']
    `qualification IS NULL OR (jsonb_typeof(qualification) = 'object' AND qualification ?& ARRAY['intent','serviceId','serviceName','period','summary','needsReview','source','status'] AND jsonb_typeof(qualification->'source') = 'string' AND jsonb_typeof(qualification->'status') = 'string' AND qualification->>'source' IN ('simulated', 'gemini') AND qualification->>'status' IN ('processando', 'qualificado', 'revisao', 'falha') AND jsonb_typeof(qualification->'needsReview') = 'boolean')` [name: 'leads_qualification_check']
  }
  Note: '''
  MIGRAÇÃO IMPLEMENTADA no MVP. PK leads_pkey. A coluna qualification da sétima migração aguarda aplicação manual.
  FK composta (conversation_id, contact_id) referencia conversations.(id, contact_id).
  ÍNDICE ÚNICO PARCIAL, somente anotado: leads_one_open_per_contact_idx
  ON (contact_id) WHERE stage IN ('novo', 'qualificado', 'em_atendimento').
  No máximo um lead aberto por contato e um por conversa.
  Extração administrativa em qualification JSON; atribuição e ordenação manual permanecem futuras.
  '''
}

Table qualification_runs {
  message_id uuid [pk, not null]
  conversation_id uuid [not null]
  job_id uuid [not null]
  reserved_attempt integer [not null]
  source text [not null]
  status text [not null, default: 'processando']
  result jsonb
  error_code text
  created_at timestamptz [not null, default: `now()`]
  finished_at timestamptz
  checks {
    `reserved_attempt > 0` [name: 'qualification_runs_reserved_attempt_check']
    `source IN ('simulated', 'gemini')` [name: 'qualification_runs_source_check']
    `status IN ('processando', 'concluida', 'descartada')` [name: 'qualification_runs_status_check']
    `error_code IN ('timeout', 'rate_limited', 'invalid_output', 'qualifier_failure', 'interrupted', 'context_limit', 'estado_humano')` [name: 'qualification_runs_error_code_check']
    `(status = 'processando' AND result IS NULL AND finished_at IS NULL) OR (status = 'concluida' AND result IS NOT NULL AND jsonb_typeof(result) = 'object' AND finished_at IS NOT NULL) OR (status = 'descartada' AND result IS NULL AND finished_at IS NOT NULL)` [name: 'qualification_result_check']
  }
  Note: 'Implementada na sétima migração; não aplicada ao banco principal nesta entrega. Uma reserva por mensagem; FKs compostas protegem os vínculos. Sem prompt/resposta bruta. Retomada sem segunda chamada externa.'
}

Table attendants {
  id uuid [pk, not null, default: `gen_random_uuid()`]
  username text [not null]
  display_name text [not null]
  password_hash text [not null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
  indexes {
    username [unique, name: 'attendants_username_key']
  }
  checks {
    `username ~ '^[a-z0-9._-]{3,32}$'` [name: 'attendants_username_format_check']
    `char_length(btrim(display_name)) BETWEEN 1 AND 80` [name: 'attendants_display_name_check']
  }
  Note: 'IMPLEMENTADA — login de atendentes (D23). PK attendants_pkey. password_hash no formato scrypt$logN$r$p$salt$hash. Sem vínculo com leads.'
}

Table attendant_sessions {
  token_hash bytea [pk, not null]
  attendant_id uuid [not null]
  created_at timestamptz [not null, default: `now()`]
  expires_at timestamptz [not null]
  indexes {
    attendant_id [name: 'attendant_sessions_attendant_id_idx']
  }
  checks {
    `octet_length(token_hash) = 32` [name: 'attendant_sessions_token_hash_check']
    `expires_at > created_at` [name: 'attendant_sessions_expiry_check']
  }
  Note: 'IMPLEMENTADA — login de atendentes (D23). PK attendant_sessions_pkey: SHA-256 do token do cookie, nunca o token.'
}

// FKs implementadas: cada constraint aparece exatamente uma vez.
// Todas mantêm ON DELETE RESTRICT, exceto attendant_sessions_attendant_fkey (CASCADE); ON UPDATE usa NO ACTION padrão do PostgreSQL.
Ref conversations_contact_id_fkey: conversations.contact_id > contacts.id [delete: restrict]
Ref messages_conversation_id_fkey: messages.conversation_id > conversations.id [delete: restrict]
Ref leads_conversation_contact_fkey: leads.(conversation_id, contact_id) > conversations.(id, contact_id) [delete: restrict]
Ref jobs_message_id_fkey: jobs.message_id > messages.id [delete: restrict]
Ref response_plans_source_message_conversation_fkey: response_plans.(source_message_id, conversation_id) > messages.(id, conversation_id) [delete: restrict]
Ref response_plans_source_job_message_fkey: response_plans.(source_job_id, source_message_id) > jobs.(id, message_id) [delete: restrict]
Ref response_blocks_plan_conversation_fkey: response_blocks.(plan_id, conversation_id) > response_plans.(id, conversation_id) [delete: restrict]
Ref response_blocks_sent_message_conversation_fkey: response_blocks.(sent_message_id, conversation_id) > messages.(id, conversation_id) [delete: restrict]
Ref qualification_message_conversation_fkey: qualification_runs.(message_id, conversation_id) > messages.(id, conversation_id) [delete: restrict]
Ref qualification_job_message_fkey: qualification_runs.(job_id, message_id) > jobs.(id, message_id) [delete: restrict]
Ref attendant_sessions_attendant_fkey: attendant_sessions.attendant_id > attendants.id [delete: cascade]

// ==================== PROPOSTAS FUTURAS — SEM MIGRAÇÃO ====================
// Mantêm os campos/índices conceituais já documentados; não descrevem tabelas existentes.
// lead_stage é apenas enum conceitual da proposta, sem enum PostgreSQL criado.
Enum lead_stage {
  novo
  qualificado
  em_atendimento
  ganho
  perdido
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

  Note: 'PLANEJADA, sem migração. Perfil único na V1. A implementação atual usa config/business-profile.json, não esta tabela.'
}

Table users {
  id uuid [pk]
  name varchar [not null]
  email varchar [not null, unique]
  password_hash varchar [not null]
  created_at timestamptz [not null, default: `now()`]

  Note: 'PREVISÃO, sem migração. Proposta antiga de usuários do painel; o login implementado usa attendants e attendant_sessions (D23).'
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

  Note: 'PLANEJADA, sem migração. Auditoria das chamadas à IA; nenhuma tabela de extração foi criada.'
}

Table lead_events {
  id uuid [pk]
  lead_id uuid [not null]
  user_id uuid
  type varchar [not null, note: 'Ex.: mudanca_estagio, assuncao, revisao']
  from_stage lead_stage
  to_stage lead_stage
  created_at timestamptz [not null, default: `now()`]

  Note: 'PLANEJADA, sem migração e opcional na V1. Histórico de mudanças do lead.'
}

// Relacionamentos somente propostos: NÃO são constraints PostgreSQL existentes.
// Em refs 1:1, a coluna da direita é a FK; leads.conversation_id é a origem.
Ref: ai_extractions.conversation_id > conversations.id
Ref: ai_extractions.lead_id > leads.id
Ref: lead_events.lead_id > leads.id
Ref: lead_events.user_id > users.id

TableGroup implementadas_no_postgresql {
  contacts
  conversations
  messages
  jobs
  response_plans
  response_blocks
  leads
  qualification_runs
  attendants
  attendant_sessions
}

TableGroup propostas_futuras_sem_migracao {
  business_profile
  users
  ai_extractions
  lead_events
}
```
