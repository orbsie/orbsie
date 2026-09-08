CREATE TABLE IF NOT EXISTS orbsie_waitlist (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmation_sent_at timestamptz,
  provider_message_id text,
  confirmation_payload jsonb,
  first_attempt_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orbsie_waitlist_pending
  ON orbsie_waitlist(next_attempt_at) WHERE confirmation_sent_at IS NULL;
CREATE TABLE IF NOT EXISTS orbsie_waitlist_limits (
  ip_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL,
  PRIMARY KEY(ip_hash, window_start)
);
