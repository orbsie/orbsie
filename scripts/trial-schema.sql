CREATE TABLE IF NOT EXISTS orbsie_trial_usage (
  bucket text PRIMARY KEY,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
