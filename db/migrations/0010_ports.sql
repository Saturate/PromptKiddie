-- Ports as first-class entities, linked to targets and findings
DO $$ BEGIN
  CREATE TYPE "public"."port_protocol" AS ENUM('tcp', 'udp');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."port_state" AS ENUM('open', 'closed', 'filtered');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS ports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  port integer NOT NULL,
  protocol port_protocol NOT NULL DEFAULT 'tcp',
  state port_state NOT NULL DEFAULT 'open',
  service text,
  version text,
  banner text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ports_target_idx ON ports(target_id);
CREATE UNIQUE INDEX IF NOT EXISTS ports_unique ON ports(target_id, port, protocol);

-- Link findings to specific ports
ALTER TABLE findings ADD COLUMN IF NOT EXISTS port_id uuid REFERENCES ports(id) ON DELETE SET NULL;
