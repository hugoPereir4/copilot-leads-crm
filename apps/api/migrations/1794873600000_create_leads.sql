-- Up Migration
ALTER TABLE public.conversations ADD CONSTRAINT conversations_id_contact_id_key UNIQUE (id, contact_id);
CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() CONSTRAINT leads_pkey PRIMARY KEY,
  conversation_id uuid NOT NULL CONSTRAINT leads_conversation_id_key UNIQUE,
  contact_id uuid NOT NULL,
  stage text NOT NULL DEFAULT 'novo',
  needs_review boolean NOT NULL DEFAULT false,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_conversation_contact_fkey FOREIGN KEY (conversation_id, contact_id)
    REFERENCES public.conversations (id, contact_id) ON DELETE RESTRICT,
  CONSTRAINT leads_stage_check CHECK (stage IN ('novo', 'qualificado', 'em_atendimento', 'ganho', 'perdido'))
);
CREATE UNIQUE INDEX leads_one_open_per_contact_idx ON public.leads (contact_id)
  WHERE stage IN ('novo', 'qualificado', 'em_atendimento');
CREATE INDEX leads_stage_created_at_idx ON public.leads (stage, created_at);

-- Down Migration
DROP TABLE public.leads;
ALTER TABLE public.conversations DROP CONSTRAINT conversations_id_contact_id_key;
