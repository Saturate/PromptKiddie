ALTER TABLE engagements ADD COLUMN IF NOT EXISTS source_url text;

CREATE TABLE IF NOT EXISTS objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  task_number integer NOT NULL,
  title text NOT NULL,
  description text,
  flag_format text,
  flag text,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS objectives_engagement_idx ON objectives(engagement_id);
