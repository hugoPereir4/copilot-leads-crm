-- Up Migration
CREATE TABLE public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type text NOT NULL,
  message_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jobs_pkey PRIMARY KEY (id),
  CONSTRAINT jobs_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES public.messages (id) ON DELETE RESTRICT,
  CONSTRAINT jobs_type_message_id_key UNIQUE (type, message_id),
  CONSTRAINT jobs_type_not_blank_check CHECK (btrim(type) <> ''),
  CONSTRAINT jobs_status_check CHECK (status IN ('pendente', 'processando', 'concluido', 'falhou')),
  CONSTRAINT jobs_max_attempts_check CHECK (max_attempts > 0),
  CONSTRAINT jobs_attempts_check CHECK (attempts >= 0 AND attempts <= max_attempts),
  CONSTRAINT jobs_locked_at_status_check CHECK (
    (status = 'processando' AND locked_at IS NOT NULL)
    OR (status <> 'processando' AND locked_at IS NULL)
  )
);

CREATE INDEX jobs_status_run_at_idx ON public.jobs (status, run_at);

-- Down Migration
DROP TABLE public.jobs;
