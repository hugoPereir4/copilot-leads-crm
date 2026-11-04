-- Up Migration
CREATE TABLE public.contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contacts_pkey PRIMARY KEY (id),
  CONSTRAINT contacts_phone_key UNIQUE (phone),
  CONSTRAINT contacts_phone_format_check CHECK (phone ~ '^[+][1-9][0-9]{1,14}$')
);

-- Down Migration
DROP TABLE public.contacts;
