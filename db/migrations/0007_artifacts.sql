CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  finding_id uuid REFERENCES findings(id) ON DELETE SET NULL,
  title text NOT NULL,
  type text NOT NULL,
  content text,
  path text,
  sha256 text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_engagement_idx ON artifacts(engagement_id);
