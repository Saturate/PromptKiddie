-- Add full-text search column to embeddings
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Add knowledge to the source type enum (safe if already exists)
DO $$ BEGIN
  ALTER TYPE embedding_source_type ADD VALUE IF NOT EXISTS 'knowledge';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Full-text search index
CREATE INDEX IF NOT EXISTS embeddings_tsv_idx ON embeddings USING gin (tsv);

-- Vector similarity index (if not already present)
CREATE INDEX IF NOT EXISTS embeddings_vector_idx
  ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
