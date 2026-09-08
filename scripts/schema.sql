CREATE TABLE IF NOT EXISTS orbs (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES "user"(id), title text NOT NULL, revision integer NOT NULL, snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), vercel_project_id text, public_url text, deployment_id text, publication_revision integer);
CREATE INDEX IF NOT EXISTS orbs_owner_idx ON orbs(owner_id);
CREATE TABLE IF NOT EXISTS orb_revisions(orb_id text NOT NULL REFERENCES orbs(id) ON DELETE CASCADE, revision integer NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(orb_id,revision));
CREATE TABLE IF NOT EXISTS generation_runs(id text PRIMARY KEY, orb_id text NOT NULL REFERENCES orbs(id), owner_id text NOT NULL, base_revision integer NOT NULL, sequence integer NOT NULL DEFAULT 0, state text NOT NULL, checkpoint jsonb, updated_at timestamptz NOT NULL DEFAULT now());

-- The pending attempt revision must never label an older public URL.
ALTER TABLE orbs ADD COLUMN IF NOT EXISTS published_revision integer;

-- Owner-scoped generated model registry. Pending reservations count toward quota.
CREATE TABLE IF NOT EXISTS generated_models (
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 2097152),
  metadata jsonb NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, sha256)
);
