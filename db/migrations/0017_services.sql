-- Service entity: structured model for discovered services on targets.
CREATE TABLE IF NOT EXISTS "services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "engagement_id" uuid NOT NULL REFERENCES "engagements"("id") ON DELETE CASCADE,
  "target_id" uuid NOT NULL REFERENCES "targets"("id") ON DELETE CASCADE,
  "port_id" uuid REFERENCES "ports"("id"),
  "port" integer,
  "protocol" text DEFAULT 'tcp',
  "name" text,
  "product" text,
  "version" text,
  "cpe" text,
  "banner" text,
  "os" text,
  "tech" jsonb DEFAULT '[]',
  "apps" jsonb DEFAULT '[]',
  "creds" jsonb DEFAULT '[]',
  "cves" jsonb DEFAULT '[]',
  "notes" text,
  "meta" jsonb,
  "discovered_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "services_engagement_idx" ON "services" ("engagement_id");
CREATE INDEX IF NOT EXISTS "services_target_idx" ON "services" ("target_id");
CREATE UNIQUE INDEX IF NOT EXISTS "services_upsert_idx" ON "services" ("engagement_id", "target_id", "port", "protocol", "product") NULLS NOT DISTINCT;

-- Link findings to services
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "service_id" uuid REFERENCES "services"("id") ON DELETE SET NULL;
