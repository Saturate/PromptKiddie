-- Add webshells column to engagements for tracking registered webshell sessions.
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS webshells jsonb DEFAULT '[]'::jsonb;
