DO $$ BEGIN
  CREATE TYPE target_status AS ENUM ('active', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE targets ADD COLUMN IF NOT EXISTS status target_status NOT NULL DEFAULT 'active';
