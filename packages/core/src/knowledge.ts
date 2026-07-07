/**
 * Knowledge base: ingest technique references, search via hybrid (vector + keyword).
 *
 * Stable technique docs (PayloadsAllTheThings, GTFObins) are chunked, embedded, and
 * stored in pgvector. Agents search on demand during playbook execution.
 * Past findings are auto-ingested so future engagements learn from them.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, eq, and } from "drizzle-orm";
import { getDb } from "./db.js";
import { embeddings } from "./schema.js";
import { getEmbeddingProvider } from "./embeddings.js";

export interface KnowledgeResult {
  id: string;
  content: string;
  source: string;
  path?: string;
  category?: string;
  score: number;
  matchType: "vector" | "keyword" | "hybrid";
}

export interface IngestResult {
  files: number;
  chunks: number;
  skipped: number;
  errors: string[];
}

export type SearchMode = "hybrid" | "vector" | "keyword";

function chunkByHeadings(content: string, maxTokens = 500): string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let tokenEstimate = 0;

  for (const line of lines) {
    const isHeading = /^#{1,3}\s/.test(line);

    if (isHeading && current.length > 0 && tokenEstimate > 50) {
      chunks.push(current.join("\n").trim());
      current = [];
      tokenEstimate = 0;
    }

    current.push(line);
    tokenEstimate += Math.ceil(line.length / 4);

    if (tokenEstimate >= maxTokens && current.length > 0) {
      chunks.push(current.join("\n").trim());
      current = [];
      tokenEstimate = 0;
    }
  }

  if (current.length > 0) {
    const text = current.join("\n").trim();
    if (text.length > 20) chunks.push(text);
  }

  return chunks;
}

function chunkByFile(content: string): string[] {
  const trimmed = content.trim();
  return trimmed.length > 20 ? [trimmed] : [];
}

export async function ingestDocument(
  content: string,
  metadata: { source: string; category?: string; path?: string },
  chunkStrategy: "heading" | "file" | "fixed" = "heading",
): Promise<number> {
  const db = getDb();
  const provider = getEmbeddingProvider();

  const chunks = chunkStrategy === "file"
    ? chunkByFile(content)
    : chunkByHeadings(content);

  for (const chunk of chunks) {
    let vector: number[];
    try {
      vector = await provider.embed(chunk);
    } catch {
      continue;
    }

    const vectorStr = `[${vector.join(",")}]`;

    await db.execute(sql`
      INSERT INTO embeddings (id, source_type, content, metadata, embedding)
      VALUES (gen_random_uuid(), 'knowledge', ${chunk}, ${JSON.stringify(metadata)}::jsonb, ${vectorStr}::vector)
    `);
  }

  return chunks.length;
}

export async function ingestDirectory(
  dirPath: string,
  opts: {
    source: string;
    extensions?: string[];
    chunkStrategy?: "heading" | "file" | "fixed";
    onProgress?: (file: string, chunks: number) => void;
  },
): Promise<IngestResult> {
  const exts = opts.extensions?.length ? opts.extensions : null;
  const result: IngestResult = { files: 0, chunks: 0, skipped: 0, errors: [] };

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (exts && !exts.includes(extname(entry.name).toLowerCase())) {
        result.skipped++;
        continue;
      }

      try {
        const content = await readFile(fullPath, "utf-8");
        if (content.trim().length < 50) {
          result.skipped++;
          continue;
        }

        const relPath = relative(dirPath, fullPath);
        const chunks = await ingestDocument(content, {
          source: opts.source,
          category: relPath.split("/")[0],
          path: relPath,
        }, opts.chunkStrategy ?? "heading");

        result.files++;
        result.chunks += chunks;
        opts.onProgress?.(relPath, chunks);
      } catch (err) {
        result.errors.push(`${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await walk(dirPath);
  return result;
}

export async function clearSource(source: string): Promise<number> {
  const db = getDb();
  const rows = await db.delete(embeddings)
    .where(sql`metadata->>'source' = ${source}`)
    .returning({ id: embeddings.id });
  return rows.length;
}

export async function searchKnowledge(
  query: string,
  opts?: { limit?: number; source?: string; mode?: SearchMode },
): Promise<KnowledgeResult[]> {
  const db = getDb();
  const limit = opts?.limit ?? 10;
  const mode = opts?.mode ?? "hybrid";
  const sourceFilter = opts?.source
    ? sql`AND metadata->>'source' = ${opts.source}`
    : sql``;

  if (mode === "keyword") {
    // OR-match: "less bin" -> 'less' | 'bin' so partial matches work.
    // Boost documents matching more terms via ts_rank.
    const orQuery = query.trim().split(/\s+/).join(" | ");
    const rows = await db.execute(sql`
      SELECT id, content, metadata,
        ts_rank(tsv, to_tsquery('english', ${orQuery})) AS score
      FROM embeddings
      WHERE source_type = 'knowledge'
        AND tsv @@ to_tsquery('english', ${orQuery})
        ${sourceFilter}
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      content: r.content as string,
      source: (r.metadata as Record<string, string>)?.source ?? "",
      path: (r.metadata as Record<string, string>)?.path,
      category: (r.metadata as Record<string, string>)?.category,
      score: r.score as number,
      matchType: "keyword" as const,
    }));
  }

  let queryVector: number[] | null = null;
  let vectorStr = "";
  try {
    const provider = getEmbeddingProvider();
    queryVector = await provider.embed(query);
    vectorStr = `[${queryVector.join(",")}]`;
  } catch {
    if (mode === "vector") return [];
    // hybrid falls back to keyword-only
  }

  if (mode === "vector") {
    const rows = await db.execute(sql`
      SELECT id, content, metadata,
        1 - (embedding <=> ${vectorStr}::vector) AS score
      FROM embeddings
      WHERE source_type = 'knowledge'
        AND embedding IS NOT NULL
        ${sourceFilter}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      content: r.content as string,
      source: (r.metadata as Record<string, string>)?.source ?? "",
      path: (r.metadata as Record<string, string>)?.path,
      category: (r.metadata as Record<string, string>)?.category,
      score: r.score as number,
      matchType: "vector" as const,
    }));
  }

  // Hybrid: Reciprocal Rank Fusion (RRF), falls back to keyword-only
  const k = 60;

  const vectorRows = queryVector
    ? await db.execute(sql`
        SELECT id, content, metadata,
          1 - (embedding <=> ${vectorStr}::vector) AS score
        FROM embeddings
        WHERE source_type = 'knowledge'
          AND embedding IS NOT NULL
          ${sourceFilter}
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT ${limit * 2}
      `)
    : { rows: [] };

  const orQuery = query.trim().split(/\s+/).join(" | ");
  const keywordRows = await db.execute(sql`
    SELECT id, content, metadata,
      ts_rank(tsv, to_tsquery('english', ${orQuery})) AS score
    FROM embeddings
    WHERE source_type = 'knowledge'
      AND tsv @@ to_tsquery('english', ${orQuery})
      ${sourceFilter}
    ORDER BY score DESC
    LIMIT ${limit * 2}
  `);

  const scores = new Map<string, { score: number; content: string; metadata: Record<string, unknown> }>();

  (vectorRows.rows as Array<Record<string, unknown>>).forEach((r, i) => {
    const id = r.id as string;
    const rrf = 1 / (k + i + 1);
    scores.set(id, {
      score: rrf,
      content: r.content as string,
      metadata: r.metadata as Record<string, unknown>,
    });
  });

  (keywordRows.rows as Array<Record<string, unknown>>).forEach((r, i) => {
    const id = r.id as string;
    const rrf = 1 / (k + i + 1);
    const existing = scores.get(id);
    if (existing) {
      existing.score += rrf;
    } else {
      scores.set(id, {
        score: rrf,
        content: r.content as string,
        metadata: r.metadata as Record<string, unknown>,
      });
    }
  });

  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([id, data]) => ({
      id,
      content: data.content,
      source: (data.metadata as Record<string, string>)?.source ?? "",
      path: (data.metadata as Record<string, string>)?.path,
      category: (data.metadata as Record<string, string>)?.category,
      score: data.score,
      matchType: "hybrid" as const,
    }));
}

export async function autoIngestFinding(finding: {
  title: string;
  description?: string | null;
  exploitScenario?: string | null;
  engagementId: string;
}): Promise<void> {
  const parts = [finding.title];
  if (finding.description) parts.push(finding.description);
  if (finding.exploitScenario) parts.push(finding.exploitScenario);
  const content = parts.join("\n\n");
  if (content.length < 30) return;

  const provider = getEmbeddingProvider();
  let vector: number[];
  try {
    vector = await provider.embed(content);
  } catch {
    return;
  }

  const db = getDb();
  const vectorStr = `[${vector.join(",")}]`;

  await db.execute(sql`
    INSERT INTO embeddings (id, engagement_id, source_type, content, metadata, embedding)
    VALUES (gen_random_uuid(), ${finding.engagementId}, 'finding', ${content},
      ${JSON.stringify({ source: "engagement", title: finding.title })}::jsonb,
      ${vectorStr}::vector)
  `);
}

const TECHNIQUES_DIR = join(dirname(fileURLToPath(import.meta.url)), "knowledge", "techniques");

export async function ingestLocal(
  onProgress?: (file: string, chunks: number) => void,
): Promise<IngestResult> {
  await clearSource("pk-techniques");
  return ingestDirectory(TECHNIQUES_DIR, {
    source: "pk-techniques",
    extensions: [".md"],
    chunkStrategy: "heading",
    onProgress,
  });
}

export async function listSources(): Promise<Array<{ source: string; chunks: number; lastIngested: Date }>> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT metadata->>'source' AS source,
      COUNT(*) AS chunks,
      MAX(created_at) AS last_ingested
    FROM embeddings
    WHERE source_type = 'knowledge'
    GROUP BY metadata->>'source'
    ORDER BY chunks DESC
  `);

  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    source: r.source as string,
    chunks: Number(r.chunks),
    lastIngested: new Date(r.last_ingested as string),
  }));
}
