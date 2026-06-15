CREATE TYPE "public"."actor" AS ENUM('orchestrator', 'agent', 'human');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."engagement_status" AS ENUM('scoping', 'active', 'paused', 'reporting', 'done');--> statement-breakpoint
CREATE TYPE "public"."engagement_type" AS ENUM('ctf', 'whitebox', 'blackbox', 'bugbounty');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('screenshot', 'scan', 'output', 'file');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('triage', 'confirmed', 'reported', 'remediated');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('new', 'read', 'done');--> statement-breakpoint
CREATE TYPE "public"."phase" AS ENUM('scoping', 'recon', 'enum', 'exploit', 'postexploit', 'report');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');--> statement-breakpoint
CREATE TYPE "public"."target_kind" AS ENUM('host', 'domain', 'url', 'app', 'repo');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"actor" "actor" DEFAULT 'orchestrator' NOT NULL,
	"phase" "phase" NOT NULL,
	"action" text NOT NULL,
	"command" text,
	"result_evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"phase" "phase" NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "engagement_type" NOT NULL,
	"status" "engagement_status" DEFAULT 'scoping' NOT NULL,
	"scope" text,
	"roe" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagements_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"finding_id" uuid,
	"type" "evidence_type" NOT NULL,
	"path" text NOT NULL,
	"sha256" text,
	"size_bytes" integer,
	"meta" jsonb,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"target_id" uuid,
	"title" text NOT NULL,
	"severity" "severity" DEFAULT 'info' NOT NULL,
	"cvss" double precision,
	"status" "finding_status" DEFAULT 'triage' NOT NULL,
	"owasp" text[],
	"attack_techniques" text[],
	"cve" text[],
	"description" text,
	"remediation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid,
	"direction" "message_direction" NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"status" "message_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"kind" "target_kind" NOT NULL,
	"identifier" text NOT NULL,
	"in_scope" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_result_evidence_id_evidence_id_fk" FOREIGN KEY ("result_evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_engagement_idx" ON "activity_log" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "agent_runs_engagement_idx" ON "agent_runs" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "evidence_engagement_idx" ON "evidence" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "findings_engagement_idx" ON "findings" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "messages_engagement_idx" ON "messages" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "targets_engagement_idx" ON "targets" USING btree ("engagement_id");