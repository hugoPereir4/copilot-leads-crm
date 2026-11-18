-- Up Migration
CREATE TABLE public.attendants (
  id uuid NOT NULL DEFAULT gen_random_uuid() CONSTRAINT attendants_pkey PRIMARY KEY,
  username text NOT NULL CONSTRAINT attendants_username_key UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendants_username_format_check CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  CONSTRAINT attendants_display_name_check CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80)
);
CREATE TABLE public.attendant_sessions (
  token_hash bytea NOT NULL CONSTRAINT attendant_sessions_pkey PRIMARY KEY,
  attendant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT attendant_sessions_attendant_fkey FOREIGN KEY (attendant_id)
    REFERENCES public.attendants (id) ON DELETE CASCADE,
  CONSTRAINT attendant_sessions_token_hash_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT attendant_sessions_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX attendant_sessions_attendant_id_idx ON public.attendant_sessions (attendant_id);

-- Down Migration
DROP TABLE public.attendant_sessions;
DROP TABLE public.attendants;
