#!/usr/bin/env tsx
import "dotenv/config";
import { seedPlaybooks } from "../packages/core/src/repo.js";
import { closeDb } from "../packages/core/src/db.js";

async function main() {
  await seedPlaybooks();
  console.log("Default playbooks seeded");
  await closeDb();
}

main().catch((err) => { console.error(err); process.exit(1); });
