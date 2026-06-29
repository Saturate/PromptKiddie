#!/usr/bin/env tsx
import "dotenv/config";
import { getDefaultPlaybook, initEngagementSteps } from "../packages/core/src/repo.js";
import { closeDb } from "../packages/core/src/db.js";

async function main() {
  const engId = process.argv[2];
  const type = process.argv[3] ?? "ctf";
  if (!engId) { console.error("Usage: tsx scripts/init-steps.ts <engagement-id> [type]"); process.exit(1); }

  const pb = await getDefaultPlaybook(type);
  if (!pb) { console.error(`No default playbook for type: ${type}`); process.exit(1); }

  const steps = await initEngagementSteps(engId, pb.id);
  console.log(`Initialized ${steps.length} steps from "${pb.name}"`);
  await closeDb();
}

main().catch((err) => { console.error(err); process.exit(1); });
