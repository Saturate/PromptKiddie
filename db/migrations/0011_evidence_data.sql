-- Store evidence file contents in DB instead of relying on host filesystem
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS data bytea;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS mime_type text;
