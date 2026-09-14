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
