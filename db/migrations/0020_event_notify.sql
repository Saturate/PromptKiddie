-- Fire pg_notify on every event insert so the supervisor and WS broadcaster
-- pick up new events in real time (same pattern as 0001_message_notify.sql).
-- Replaces the old notify_event function which was missing payload/source fields
-- and used snake_case keys instead of camelCase.

DROP TRIGGER IF EXISTS events_notify ON events;

CREATE OR REPLACE FUNCTION notify_pk_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('pk_events', json_build_object(
    'id', NEW.id,
    'engagementId', NEW.engagement_id,
    'type', NEW.type,
    'payload', NEW.payload,
    'source', NEW.source,
    'createdAt', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_notify_trigger
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION notify_pk_event();
