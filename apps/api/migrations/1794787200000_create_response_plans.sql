-- Up Migration
-- As chaves compostas permitem conferir os vínculos, não apenas a existência dos IDs.
ALTER TABLE public.messages
  ADD CONSTRAINT messages_id_conversation_id_key UNIQUE (id, conversation_id);
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_id_message_id_key UNIQUE (id, message_id);

CREATE TABLE public.response_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  source_job_id uuid NOT NULL,
  action text NOT NULL,
  expected_status text NOT NULL,
  next_status text NOT NULL,
  reference_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,

  CONSTRAINT response_plans_pkey PRIMARY KEY (id),
  CONSTRAINT response_plans_id_conversation_id_key UNIQUE (id, conversation_id),
  CONSTRAINT response_plans_source_message_id_key UNIQUE (source_message_id),
  CONSTRAINT response_plans_source_message_conversation_fkey
    FOREIGN KEY (source_message_id, conversation_id)
    REFERENCES public.messages (id, conversation_id) ON DELETE RESTRICT,
  CONSTRAINT response_plans_source_job_message_fkey
    FOREIGN KEY (source_job_id, source_message_id)
    REFERENCES public.jobs (id, message_id) ON DELETE RESTRICT,
  CONSTRAINT response_plans_expected_status_check CHECK (expected_status = 'aguardando_menu'),
  CONSTRAINT response_plans_action_next_status_check CHECK (
    (action IN ('enviar_abertura', 'reapresentar_menu') AND next_status = 'aguardando_menu')
    OR (action IN ('informar_servicos', 'informar_valores_horarios') AND next_status = 'aguardando_detalhes')
  ),
  CONSTRAINT response_plans_status_check CHECK (status IN ('pendente', 'enviado', 'cancelado')),
  CONSTRAINT response_plans_finite_dates_check CHECK (isfinite(reference_at) AND isfinite(created_at)),
  CONSTRAINT response_plans_finished_status_check CHECK (
    (status = 'pendente' AND finished_at IS NULL)
    OR (status <> 'pendente' AND finished_at IS NOT NULL)
  ),
  CONSTRAINT response_plans_finished_at_check CHECK (
    finished_at IS NULL OR (isfinite(finished_at) AND finished_at >= created_at)
  )
);

-- Abertura permanece única inclusive depois de enviada ou cancelada.
CREATE UNIQUE INDEX response_plans_opening_conversation_key
  ON public.response_plans (conversation_id) WHERE action = 'enviar_abertura';
CREATE UNIQUE INDEX response_plans_pending_conversation_key
  ON public.response_plans (conversation_id) WHERE status = 'pendente';

CREATE TABLE public.response_blocks (
  plan_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  position integer NOT NULL,
  text text NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  sent_message_id uuid,
  sent_at timestamptz,

  CONSTRAINT response_blocks_pkey PRIMARY KEY (plan_id, position),
  CONSTRAINT response_blocks_plan_conversation_fkey
    FOREIGN KEY (plan_id, conversation_id)
    REFERENCES public.response_plans (id, conversation_id) ON DELETE RESTRICT,
  CONSTRAINT response_blocks_sent_message_conversation_fkey
    FOREIGN KEY (sent_message_id, conversation_id)
    REFERENCES public.messages (id, conversation_id) ON DELETE RESTRICT,
  CONSTRAINT response_blocks_sent_message_id_key UNIQUE (sent_message_id),
  CONSTRAINT response_blocks_position_check CHECK (position > 0),
  CONSTRAINT response_blocks_text_not_blank_check CHECK (text ~ '[^[:space:]]'),
  CONSTRAINT response_blocks_status_check CHECK (status IN ('pendente', 'enviado', 'cancelado')),
  CONSTRAINT response_blocks_sent_status_check CHECK (
    (status = 'enviado' AND sent_message_id IS NOT NULL AND sent_at IS NOT NULL)
    OR (status <> 'enviado' AND sent_message_id IS NULL AND sent_at IS NULL)
  ),
  CONSTRAINT response_blocks_sent_at_check CHECK (sent_at IS NULL OR isfinite(sent_at))
);

-- Down Migration
DROP TABLE public.response_blocks;
DROP TABLE public.response_plans;
ALTER TABLE public.jobs DROP CONSTRAINT jobs_id_message_id_key;
ALTER TABLE public.messages DROP CONSTRAINT messages_id_conversation_id_key;
