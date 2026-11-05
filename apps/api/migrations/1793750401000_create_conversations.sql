-- Up Migration
CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'aguardando_menu',
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,

  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES public.contacts (id) ON DELETE RESTRICT,
  CONSTRAINT conversations_status_check CHECK (status IN (
    'aguardando_menu',
    'aguardando_detalhes',
    'qualificando',
    'aguardando_humano',
    'em_atendimento_humano',
    'encerrada'
  )),
  CONSTRAINT conversations_closed_at_status_check CHECK (
    (status = 'encerrada' AND closed_at IS NOT NULL)
    OR (status <> 'encerrada' AND closed_at IS NULL)
  )
);

CREATE UNIQUE INDEX conversations_one_open_per_contact_idx
  ON public.conversations (contact_id)
  WHERE status <> 'encerrada';

CREATE INDEX conversations_contact_status_idx
  ON public.conversations (contact_id, status);

-- Down Migration
DROP TABLE public.conversations;
