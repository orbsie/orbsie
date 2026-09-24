CREATE TABLE IF NOT EXISTS orbsie_authoring_runs (
  run_id uuid PRIMARY KEY,
  identity_hash text NOT NULL CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  project_id text NOT NULL CHECK (length(project_id) BETWEEN 1 AND 80),
  provider text NOT NULL CHECK (provider IN ('free', 'openrouter', 'gateway', 'chatgpt')),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 256),
  effort text CHECK (effort IS NULL OR length(effort) BETWEEN 1 AND 32),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  initial_revision bigint NOT NULL CHECK (initial_revision >= 0),
  initial_scene_digest text NOT NULL CHECK (initial_scene_digest ~ '^[0-9a-f]{64}$'),
  phase text NOT NULL DEFAULT 'active' CHECK (phase IN ('active', 'completed', 'reviewing', 'final-review', 'finalized', 'failed')),
  remaining_review_slots smallint NOT NULL DEFAULT 3,
  phase_token_hash text CHECK (phase_token_hash IS NULL OR phase_token_hash ~ '^[0-9a-f]{64}$'),
  phase_token_expires_at timestamptz,
  completed_revision bigint CHECK (completed_revision IS NULL OR completed_revision >= 0),
  completed_scene_digest text CHECK (completed_scene_digest IS NULL OR completed_scene_digest ~ '^[0-9a-f]{64}$'),
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orbsie_authoring_runs_remaining_review_slots_check
    CHECK (remaining_review_slots BETWEEN 0 AND 3),
  CHECK ((phase_token_hash IS NULL) = (phase_token_expires_at IS NULL)),
  CHECK (phase NOT IN ('completed', 'reviewing', 'final-review', 'finalized') OR completed_revision IS NOT NULL),
  CHECK (phase NOT IN ('completed', 'reviewing', 'final-review', 'finalized') OR completed_scene_digest IS NOT NULL),
  CHECK (phase <> 'failed' OR failed_at IS NOT NULL),
  CHECK (phase <> 'finalized' OR remaining_review_slots = 0)
);

ALTER TABLE orbsie_authoring_runs
  ALTER COLUMN remaining_review_slots SET DEFAULT 3;

DO $$
DECLARE
  slot_constraint_definition text;
BEGIN
  SELECT regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]()]', '', 'g')
    INTO slot_constraint_definition
  FROM pg_constraint
  WHERE conrelid = 'orbsie_authoring_runs'::regclass
    AND conname = 'orbsie_authoring_runs_remaining_review_slots_check'
    AND contype = 'c';

  IF slot_constraint_definition IS NULL THEN
    ALTER TABLE orbsie_authoring_runs
      ADD CONSTRAINT orbsie_authoring_runs_remaining_review_slots_check
      CHECK (remaining_review_slots BETWEEN 0 AND 3);
  ELSIF slot_constraint_definition IN (
    'checkremaining_review_slots>=0andremaining_review_slots<=2',
    'checkremaining_review_slotsbetween0and2'
  ) THEN
    ALTER TABLE orbsie_authoring_runs
      DROP CONSTRAINT orbsie_authoring_runs_remaining_review_slots_check;
    ALTER TABLE orbsie_authoring_runs
      ADD CONSTRAINT orbsie_authoring_runs_remaining_review_slots_check
      CHECK (remaining_review_slots BETWEEN 0 AND 3);
  ELSIF slot_constraint_definition NOT IN (
    'checkremaining_review_slots>=0andremaining_review_slots<=3',
    'checkremaining_review_slotsbetween0and3'
  ) THEN
    RAISE EXCEPTION 'Unexpected remaining_review_slots constraint definition';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS orbsie_authoring_runs_identity_idx
  ON orbsie_authoring_runs(identity_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS orbsie_authoring_runs_expiry_idx
  ON orbsie_authoring_runs(expires_at);
