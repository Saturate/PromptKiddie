-- Remove the old step-based playbook system (replaced by Action SDK + event-driven supervisor)

-- Drop engagement_steps first (references playbook_blocks and engagements)
DROP TABLE IF EXISTS engagement_steps;

-- Drop playbook_blocks
DROP TABLE IF EXISTS playbook_blocks;

-- Drop playbook_id FK from engagements before dropping playbooks
ALTER TABLE engagements DROP COLUMN IF EXISTS playbook_id;

-- Drop playbooks table
DROP TABLE IF EXISTS playbooks;

-- Drop step_status enum (was used by engagement_steps.status but column was text, not enum; safe to drop if exists)
DROP TYPE IF EXISTS step_status;
