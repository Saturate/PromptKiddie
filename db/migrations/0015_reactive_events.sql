-- Events table: domain events for reactive playbook evaluation
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_engagement_idx ON events(engagement_id);
CREATE INDEX IF NOT EXISTS events_type_idx ON events(type);

-- NOTIFY trigger for real-time event consumption
CREATE OR REPLACE FUNCTION notify_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('pk_events', json_build_object(
    'id', NEW.id,
    'type', NEW.type,
    'engagement_id', NEW.engagement_id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_notify AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION notify_event();

-- Discoveries table: knowledge atoms (positive/negative/attempted)
DO $$ BEGIN
  CREATE TYPE discovery_type AS ENUM ('positive', 'negative', 'attempted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS discoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  type discovery_type NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail JSONB,
  source_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  parent_id UUID,
  superseded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discoveries_engagement_idx ON discoveries(engagement_id);
CREATE INDEX IF NOT EXISTS discoveries_engagement_category_idx ON discoveries(engagement_id, category);

-- Exec dedup table: normalized command + exit code tracking
CREATE TABLE IF NOT EXISTS exec_dedup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  command_normalized TEXT NOT NULL,
  target TEXT NOT NULL,
  exit_code INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome_summary TEXT
);

CREATE INDEX IF NOT EXISTS exec_dedup_engagement_idx ON exec_dedup(engagement_id);
CREATE INDEX IF NOT EXISTS exec_dedup_lookup_idx ON exec_dedup(engagement_id, command_normalized, target, exit_code);
