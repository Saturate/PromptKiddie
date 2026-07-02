/**
 * Provider-agnostic embedding interface.
 * Provider/model/URL configured via PkConfig.embeddings (config.toml or env vars).
 */
import { loadConfig } from "./config.js";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  readonly dimensions: number;
  readonly name: string;
}

interface OllamaEmbedResponse {
  embeddings: number[][];
}

class OllamaProvider implements EmbeddingProvider {
  private readonly url: string;
  private readonly model: string;
  private cachedDimensions: number;
  readonly name = "ollama";

  constructor(url: string, model: string, dimensions: number) {
    this.url = url;
    this.model = model;
    this.cachedDimensions = dimensions;
  }

  get dimensions(): number {
    return this.cachedDimensions;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.url}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama embed failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as OllamaEmbedResponse;
    const embedding = data.embeddings[0];
    if (!embedding) throw new Error("Ollama returned empty embeddings");

    this.cachedDimensions = embedding.length;
    return embedding;
  }
}

interface OpenAIEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

class OpenAICompatibleProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;

  constructor(name: string, baseUrl: string, model: string, apiKey: string | null, dimensions: number) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.model = model;
    this.apiKey = apiKey;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: text, model: this.model }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${this.name} embed failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as OpenAIEmbedResponse;
    const embedding = data.data[0]?.embedding;
    if (!embedding) throw new Error(`${this.name} returned empty embeddings`);
    return embedding;
  }
}

class OnnxProvider implements EmbeddingProvider {
  readonly name = "onnx";
  private cachedDimensions: number;
  private pipeline: unknown = null;
  private loading: Promise<unknown> | null = null;
  private readonly model: string;

  constructor(model: string, dimensions: number) {
    this.model = model;
    this.cachedDimensions = dimensions;
  }

  get dimensions(): number {
    return this.cachedDimensions;
  }

  private async getPipeline() {
    if (this.pipeline) return this.pipeline;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = true;
      env.useBrowserCache = false;
      const pipe = await pipeline("feature-extraction", this.model, {
        dtype: "fp32",
      });
      this.pipeline = pipe;
      return pipe;
    })();

    return this.loading;
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await this.getPipeline() as (input: string, opts: Record<string, unknown>) => Promise<{ tolist: () => number[][] }>;
    const output = await pipe(text, { pooling: "mean", normalize: true });
    const vector = output.tolist()[0];
    this.cachedDimensions = vector.length;
    return vector;
  }
}

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!provider) {
    const cfg = loadConfig().embeddings;
    provider = buildProvider(cfg.provider, cfg.model, cfg.url, cfg.api_key, cfg.dimensions);
  }
  return provider;
}

export async function getEmbeddingProviderFromSettings(): Promise<EmbeddingProvider> {
  if (provider) return provider;
  try {
    const { getSetting } = await import("./repo.js");
    const dbProvider = await getSetting("embeddings.provider") as string | null;
    if (dbProvider) {
      const dbModel = (await getSetting("embeddings.model") as string) ?? "";
      const dbUrl = (await getSetting("embeddings.url") as string) ?? "";
      const dbKey = (await getSetting("embeddings.api_key") as string) ?? "";
      const dbDims = Number(await getSetting("embeddings.dimensions")) || 384;
      provider = buildProvider(dbProvider, dbModel, dbUrl || null, dbKey || null, dbDims);
      return provider;
    }
  } catch {
    // DB not available, fall back to config
  }
  return getEmbeddingProvider();
}

function buildProvider(
  backend: string, model: string, url: string | null, apiKey: string | null, dimensions: number,
): EmbeddingProvider {
  switch (backend) {
    case "openai":
      return new OpenAICompatibleProvider("openai", url ?? "https://api.openai.com/v1", model, apiKey, dimensions);
    case "llamacpp":
      return new OpenAICompatibleProvider("llamacpp", url ?? "http://localhost:8080/v1", model, apiKey, dimensions);
    case "ollama":
      return new OllamaProvider(url ?? "http://localhost:11434", model, dimensions);
    default:
      return new OnnxProvider(model, dimensions);
  }
}

export function setEmbeddingProvider(p: EmbeddingProvider) {
  provider = p;
}

export async function checkEmbeddingModel(): Promise<{ ok: boolean; error?: string; provider?: string }> {
  const cfg = loadConfig().embeddings;

  if (cfg.provider === "onnx") {
    return { ok: true, provider: `onnx (${cfg.model})` };
  }

  if (cfg.provider === "ollama") {
    const url = cfg.url ?? "http://localhost:11434";
    try {
      const res = await fetch(`${url}/api/tags`);
      if (!res.ok) return { ok: false, error: `Ollama not responding (${res.status})` };

      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      const hasModel = models.some((m) => m.name === cfg.model || m.name.startsWith(`${cfg.model}:`));

      if (!hasModel) {
        return { ok: false, error: `Model ${cfg.model} not pulled. Run: ollama pull ${cfg.model}` };
      }
      return { ok: true, provider: `ollama (${cfg.model})` };
    } catch {
      return { ok: false, error: `Ollama not reachable at ${url}` };
    }
  }

  return { ok: true, provider: `${cfg.provider} (${cfg.model})` };
}
