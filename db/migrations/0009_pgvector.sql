-- Enable pgvector for semantic memory across engagements
CREATE EXTENSION IF NOT EXISTS vector;

-- Embeddings table: stores vector representations of findings, tool outputs, and activity
CREATE TABLE IF NOT EXISTS embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid REFERENCES engagements(id) ON DELETE CASCADE,
  source_type text NOT NULL, -- 'finding' | 'exec_output' | 'activity' | 'brief'
  source_id uuid, -- optional FK to the source row
  content text NOT NULL, -- the text that was embedded
  embedding vector(384), -- all-MiniLM-L6-v2 (ONNX default); set PK_EMBEDDINGS=ollama for 768-dim nomic-embed-text
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS embeddings_engagement_idx ON embeddings(engagement_id);
CREATE INDEX IF NOT EXISTS embeddings_source_type_idx ON embeddings(source_type);
