-- Playbook-driven engagement flow
-- Templates define phases+steps, engagement_steps tracks progress

CREATE TABLE IF NOT EXISTS playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  engagement_type text NOT NULL, -- ctf, blackbox, whitebox, bugbounty
  description text,
  is_default boolean NOT NULL DEFAULT false,
  phases jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS playbooks_default_idx ON playbooks(engagement_type) WHERE is_default;

-- Per-engagement step tracking
CREATE TABLE IF NOT EXISTS engagement_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  phase text NOT NULL,
  step_key text NOT NULL, -- unique within the playbook, e.g. "recon.port_scan"
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending, done, skipped, running
  skip_reason text,
  result_type text, -- 'port', 'finding', 'evidence', 'activity'
  result_id uuid, -- FK to the result row
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engagement_steps_eng_idx ON engagement_steps(engagement_id);
CREATE UNIQUE INDEX IF NOT EXISTS engagement_steps_unique ON engagement_steps(engagement_id, step_key);

-- Link engagement to its playbook
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS playbook_id uuid REFERENCES playbooks(id) ON DELETE SET NULL;
