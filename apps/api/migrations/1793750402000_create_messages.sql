-- Up Migration
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  direction text NOT NULL,
  sender_type text NOT NULL,
  kind text NOT NULL,
  body text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations (id) ON DELETE RESTRICT,
  CONSTRAINT messages_provider_external_id_key UNIQUE (provider, external_id),
  CONSTRAINT messages_provider_not_blank_check CHECK (btrim(provider) <> ''),
  CONSTRAINT messages_external_id_not_blank_check CHECK (btrim(external_id) <> ''),
  CONSTRAINT messages_direction_check CHECK (direction IN ('entrada', 'saida')),
  CONSTRAINT messages_sender_type_check CHECK (sender_type IN ('contato', 'bot', 'atendente')),
  CONSTRAINT messages_kind_check CHECK (kind IN ('texto', 'audio', 'outro'))
);

CREATE INDEX messages_conversation_created_at_idx
  ON public.messages (conversation_id, created_at);

-- Down Migration
DROP TABLE public.messages;
