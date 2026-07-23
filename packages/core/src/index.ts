export * as schema from "./schema.js";
export { getDb, closeDb, databaseUrl, type Db } from "./db.js";
export * from "./repo.js";
export { generateReport, type GenerateReportResult } from "./report.js";
export { loadConfig, resetConfig, type PkConfig } from "./config.js";
export { getRepo, type Repo } from "./client.js";
export { parseNmapOutput, ingestPorts, looksLikeNmapOutput } from "./port-parser.js";
export { startExecWatcher, type ExecWatcherOptions, type ExecLogEntry } from "./exec-watcher.js";
export {
  getEmbeddingProvider,
  getEmbeddingProviderFromSettings,
  setEmbeddingProvider,
  checkEmbeddingModel,
  type EmbeddingProvider,
} from "./embeddings.js";
export {
  ingestDocument,
  ingestDirectory,
  clearSource,
  searchKnowledge,
  autoIngestFinding,
  ingestLocal,
  listSources,
  type KnowledgeResult,
  type IngestResult,
  type SearchMode,
  parseFrontmatter,
  seedKnowledge,
  type SeedResult,
} from "./knowledge.js";
export {
  KNOWLEDGE_SOURCES,
  getKnowledgeSource,
  type KnowledgeSource,
  type FrontmatterFilter,
} from "./knowledge-sources.js";
export { buildLlmContext, type LlmContext } from "./context-builder.js";
export {
  type Action,
  type RunContext,
  type Playbook,
  type PlaybookMeta,
  type EngagementEvent,
  type EngagementState,
  type ExecResult,
  type ExecOpts,
  type LlmRunner,
  type MockContext,
  type MockExecEntry,
  type MockExecMap,
  type ExecCall,
  type MockContextOpts,
  type ExploitHit,
  type LlmOpts,
  type CallbackOpts,
  type CallbackInfo,
  createMockContext,
} from "./sdk.js";
export { CTF_PLAYBOOK as CTF_ACTIONS } from "./actions/index.js";
export { PENTEST_PLAYBOOK, runPhasedPentest } from "./actions/index.js";
export { buildActionGraph, actionGraphToMermaid, simulateGraph, type ActionGraph, type ActionNode, type ActionEdge, type SimulationStep } from "./action-graph.js";
export {
  webFingerprint, headerInspect, wafDetect,
  linuxPrivesc, windowsPrivesc,
  crackHashes, passwordSpray,
  sysinfo, localCreds, internalNet,
  pathTraversal,
  windowsForensics, lateralMovement,
} from "./actions/index.js";
