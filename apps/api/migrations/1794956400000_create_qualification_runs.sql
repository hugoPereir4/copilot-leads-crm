-- Up Migration
ALTER TABLE public.leads ADD COLUMN qualification jsonb;
ALTER TABLE public.leads ADD CONSTRAINT leads_qualification_check CHECK (
  qualification IS NULL OR (
    jsonb_typeof(qualification) = 'object'
    AND qualification ?& ARRAY['intent','serviceId','serviceName','period','summary','needsReview','source','status']
    AND jsonb_typeof(qualification->'source') = 'string'
    AND jsonb_typeof(qualification->'status') = 'string'
    AND qualification->>'source' IN ('simulated', 'gemini')
    AND qualification->>'status' IN ('processando', 'qualificado', 'revisao', 'falha')
    AND jsonb_typeof(qualification->'needsReview') = 'boolean'
  )
);
CREATE TABLE public.qualification_runs (
  message_id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  job_id uuid NOT NULL,
  reserved_attempt integer NOT NULL CHECK (reserved_attempt > 0),
  source text NOT NULL CHECK (source IN ('simulated', 'gemini')),
  status text NOT NULL DEFAULT 'processando' CHECK (status IN ('processando', 'concluida', 'descartada')),
  result jsonb,
  error_code text CHECK (error_code IN ('timeout', 'rate_limited', 'invalid_output', 'qualifier_failure', 'interrupted', 'context_limit', 'estado_humano')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT qualification_message_conversation_fkey FOREIGN KEY (message_id, conversation_id)
    REFERENCES public.messages (id, conversation_id) ON DELETE RESTRICT,
  CONSTRAINT qualification_job_message_fkey FOREIGN KEY (job_id, message_id)
    REFERENCES public.jobs (id, message_id) ON DELETE RESTRICT,
  CONSTRAINT qualification_result_check CHECK (
    (status = 'processando' AND result IS NULL AND finished_at IS NULL)
    OR (status = 'concluida' AND result IS NOT NULL AND jsonb_typeof(result) = 'object' AND finished_at IS NOT NULL)
    OR (status = 'descartada' AND result IS NULL AND finished_at IS NOT NULL)
  )
);

-- Down Migration
DROP TABLE public.qualification_runs;
ALTER TABLE public.leads DROP CONSTRAINT leads_qualification_check;
ALTER TABLE public.leads DROP COLUMN qualification;
