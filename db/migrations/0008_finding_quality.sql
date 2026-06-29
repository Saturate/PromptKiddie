-- Finding quality upgrade: structured fields for adversarial verification, CVSS vectors, and evidence gates
DO $$ BEGIN
  CREATE TYPE "public"."finding_verdict" AS ENUM('true_positive', 'false_positive', 'unverified');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "cvss_vector" text;
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "cwe" text;
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "exploit_scenario" text;
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "preconditions" text[];
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "source_ref" text;
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "sink_ref" text;
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "confidence" double precision;
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "verdict" "finding_verdict" DEFAULT 'unverified';
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "verdict_confidence" integer;
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "verdict_reason" text;
