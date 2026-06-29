#!/usr/bin/env tsx
/**
 * One-time backfill: read evidence files from disk and store in DB.
 * Run: tsx scripts/backfill-evidence.ts
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../packages/core/src/db.js";
import { evidence } from "../packages/core/src/schema.js";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json",
  ".jsonl": "text/plain", ".xml": "application/xml", ".html": "text/html",
  ".csv": "text/csv", ".log": "text/plain",
};

function guessMime(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

async function main() {
  const db = getDb();
  const rows = await db.select().from(evidence);

  console.log(`Found ${rows.length} evidence rows to backfill`);
  let filled = 0;
  let skipped = 0;
  let missing = 0;

  for (const row of rows) {
    if (row.data) {
      skipped++;
      continue;
    }

    const filePath = resolve(row.path);
    try {
      await stat(filePath);
    } catch {
      console.log(`  MISS: ${row.path}`);
      missing++;
      continue;
    }

    const buf = await readFile(filePath);
    const hash = createHash("sha256").update(buf).digest("hex");
    const mime = guessMime(row.path);

    await db.update(evidence)
      .set({
        data: buf,
        sha256: hash,
        sizeBytes: buf.length,
        mimeType: mime,
      })
      .where(eq(evidence.id, row.id));

    console.log(`  OK: ${row.path} (${Math.round(buf.length / 1024)}KB, ${mime})`);
    filled++;
  }

  console.log(`\nDone: ${filled} filled, ${skipped} already had data, ${missing} files not found`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
