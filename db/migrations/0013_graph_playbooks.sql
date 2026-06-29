-- Evolve playbooks from linear lists to behavior-tree DAGs with reusable blocks

-- Blocks: reusable sub-graphs (like functions)
CREATE TABLE IF NOT EXISTS playbook_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  -- Typed inputs/outputs for composability
  input_schema jsonb DEFAULT '{}',  -- { host: "string", port: "number" }
  output_schema jsonb DEFAULT '{}', -- { directories: "string[]", findings: "Finding[]" }
  -- The sub-graph: array of nodes
  nodes jsonb NOT NULL DEFAULT '[]',
  -- Who created it
  is_builtin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Upgrade engagement_steps with graph fields
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS depends_on text[] DEFAULT '{}';
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS node_type text DEFAULT 'action';
-- node_type: 'action' | 'sequence' | 'selector' | 'parallel' | 'gate' | 'block_ref'
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS priority integer DEFAULT 50;
-- 0 = highest priority, 100 = lowest. Selectors try children in priority order.
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES playbook_blocks(id) ON DELETE SET NULL;
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS inputs jsonb DEFAULT '{}';
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS outputs jsonb DEFAULT '{}';
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS condition text;
-- JSONPath expression evaluated against engagement state snapshot
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS cost_tokens integer DEFAULT 0;
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS agent_id text;
-- Which agent/branch is working on this node

-- Position data for react-flow layout
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS position_x double precision DEFAULT 0;
ALTER TABLE engagement_steps ADD COLUMN IF NOT EXISTS position_y double precision DEFAULT 0;
