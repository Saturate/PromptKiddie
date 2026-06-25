CREATE TABLE IF NOT EXISTS agent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  agent text NOT NULL,
  phase phase NOT NULL,
  message text NOT NULL,
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_log_engagement_idx ON agent_log(engagement_id);
