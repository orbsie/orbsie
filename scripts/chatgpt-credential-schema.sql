-- Durable app-owned managed-runtime cache. Raw cache bytes never enter browser
-- state, project snapshots, model requests, diagnostics, or publication data.
CREATE TABLE IF NOT EXISTS chatgpt_credential_connections (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  connection_version integer NOT NULL DEFAULT 1 CHECK (connection_version > 0),
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The intent fence is separate from the remembered connection.  A revoked
-- intent remains as a tombstone so a late login completion cannot recreate a
-- connection after Disconnect.
CREATE TABLE IF NOT EXISTS chatgpt_credential_intents (
  owner_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  epoch integer NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  pending_attempt_id text,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chatgpt_credential_connections
  ADD COLUMN IF NOT EXISTS intent_epoch integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS host_attempt_id text;

CREATE UNIQUE INDEX IF NOT EXISTS chatgpt_credential_active_owner_idx
  ON chatgpt_credential_connections(owner_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS chatgpt_credential_retention_idx
  ON chatgpt_credential_connections(expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS chatgpt_credential_vault (
  connection_id uuid PRIMARY KEY
    REFERENCES chatgpt_credential_connections(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  ciphertext text NOT NULL
    CHECK (octet_length(ciphertext) <= 100000),
  lease_id uuid,
  lease_epoch integer NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chatgpt_credential_lease_idx
  ON chatgpt_credential_vault(lease_until);
