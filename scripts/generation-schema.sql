ALTER TABLE generation_runs ADD COLUMN IF NOT EXISTS starting_snapshot jsonb;
ALTER TABLE generation_runs ADD COLUMN IF NOT EXISTS prompt text;
ALTER TABLE generation_runs ADD COLUMN IF NOT EXISTS selected text;
ALTER TABLE generation_runs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE generation_runs ADD COLUMN IF NOT EXISTS lease_until timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS generation_runs_owner_idx ON generation_runs(owner_id);
CREATE TABLE IF NOT EXISTS generation_operations (
 run_id text NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 256),
 operation_id text NOT NULL,
 envelope jsonb NOT NULL,
 PRIMARY KEY(run_id,sequence),
 UNIQUE(run_id,operation_id)
);
