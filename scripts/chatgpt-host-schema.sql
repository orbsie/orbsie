-- Private host capabilities never enter project snapshots or browser storage.
CREATE TABLE IF NOT EXISTS chatgpt_hosts (
  session_id text PRIMARY KEY REFERENCES "session"(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('provisioning', 'ready')),
  sandbox_name text,
  capability_ciphertext text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'provisioning' AND sandbox_name IS NULL AND capability_ciphertext IS NULL)
      OR (state = 'ready' AND sandbox_name IS NOT NULL AND capability_ciphertext IS NOT NULL))
);
-- Added after the initial table so existing host records remain readable but stale.
ALTER TABLE chatgpt_hosts ADD COLUMN IF NOT EXISTS artifact_digest text;
CREATE INDEX IF NOT EXISTS chatgpt_hosts_expiry_idx ON chatgpt_hosts(expires_at);
