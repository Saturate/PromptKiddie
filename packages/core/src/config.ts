/**
 * TOML-based configuration for PromptKiddie.
 *
 * Resolution order (later wins):
 *   1. Defaults
 *   2. Global:    ~/.pk/config.toml
 *   3. Workspace: .pk/config.toml  (in project root)
 *   4. Environment variables (PK_*, DATABASE_URL)
 */
import { parse } from "smol-toml";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface PkConfig {
  database: {
    url: string;
  };
  attackbox: {
    container: string;
    host: string | null;
    timeout: number;
    exec_mode: "docker" | "local";
  };
  workspace: {
    evidence_root: string;
    tool_log_dir: string;
  };
  vpn: {
    config_path: string;
  };
  inbox: {
    poll_seconds: number;
  };
  api: {
    url: string | null;
    secret: string | null;
    port: number;
  };
  embeddings: {
    provider: "onnx" | "ollama" | "openai" | "llamacpp";
    model: string;
    url: string | null;
    api_key: string | null;
    dimensions: number;
  };
}

const DEFAULTS: PkConfig = {
  database: {
    url: "postgres://promptkiddie:changeme_local_only@localhost:5432/promptkiddie",
  },
  attackbox: {
    container: "promptkiddie-attackbox",
    host: null,
    timeout: 300000,
    exec_mode: "docker",
  },
  workspace: {
    evidence_root: "./engagements",
    tool_log_dir: "./engagements/.tool-log",
  },
  vpn: {
    config_path: "./vpn",
  },
  inbox: {
    poll_seconds: 15,
  },
  api: {
    url: null,
    secret: null,
    port: 3200,
  },
  embeddings: {
    provider: "onnx",
    model: "Xenova/all-MiniLM-L6-v2",
    url: null,
    api_key: null,
    dimensions: 384,
  },
};

function loadToml(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      typeof target[key] === "object" &&
      target[key] !== null
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function applyEnvOverrides(config: PkConfig): PkConfig {
  if (process.env.DATABASE_URL) config.database.url = process.env.DATABASE_URL;
  if (process.env.PK_TOOLING_CONTAINER) config.attackbox.container = process.env.PK_TOOLING_CONTAINER;
  if (process.env.PK_EXEC_MODE) config.attackbox.exec_mode = process.env.PK_EXEC_MODE as "docker" | "local";
  if (process.env.PK_TOOLING_TIMEOUT) config.attackbox.timeout = Number(process.env.PK_TOOLING_TIMEOUT);
  if (process.env.PK_EVIDENCE_ROOT) config.workspace.evidence_root = process.env.PK_EVIDENCE_ROOT;
  if (process.env.PK_TOOL_LOG_DIR) config.workspace.tool_log_dir = process.env.PK_TOOL_LOG_DIR;
  if (process.env.PK_VPN_CONFIG) config.vpn.config_path = process.env.PK_VPN_CONFIG;
  if (process.env.PK_INBOX_POLL_SECONDS) config.inbox.poll_seconds = Number(process.env.PK_INBOX_POLL_SECONDS);
  if (process.env.PK_API_URL) config.api.url = process.env.PK_API_URL;
  if (process.env.PK_API_SECRET) config.api.secret = process.env.PK_API_SECRET;
  if (process.env.PK_API_PORT) config.api.port = Number(process.env.PK_API_PORT);
  if (process.env.PK_EMBEDDINGS) config.embeddings.provider = process.env.PK_EMBEDDINGS as PkConfig["embeddings"]["provider"];
  if (process.env.PK_EMBED_MODEL) config.embeddings.model = process.env.PK_EMBED_MODEL;
  if (process.env.PK_EMBED_URL) config.embeddings.url = process.env.PK_EMBED_URL;
  if (process.env.PK_EMBED_API_KEY) config.embeddings.api_key = process.env.PK_EMBED_API_KEY;
  if (process.env.PK_EMBED_DIMENSIONS) config.embeddings.dimensions = Number(process.env.PK_EMBED_DIMENSIONS);
  return config;
}

let _config: PkConfig | null = null;

export function loadConfig(): PkConfig {
  if (_config) return _config;

  const globalPath = join(homedir(), ".pk", "config.toml");
  const workspacePath = join(process.cwd(), ".pk", "config.toml");

  let merged = structuredClone(DEFAULTS) as unknown as Record<string, unknown>;
  merged = deepMerge(merged, loadToml(globalPath));
  merged = deepMerge(merged, loadToml(workspacePath));

  _config = applyEnvOverrides(merged as unknown as PkConfig);
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
