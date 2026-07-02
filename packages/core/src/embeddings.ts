/**
 * Provider-agnostic embedding interface.
 * Adapted from github.com/saturate/husk.
 * Supports Ollama (default, local), OpenAI-compatible APIs, and Transformers.js.
 */

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
  private cachedDimensions: number | null = null;
  readonly name = "ollama";

  constructor(url?: string, model?: string) {
    this.url = url ?? process.env.PK_EMBED_URL ?? "http://localhost:11434";
    this.model = model ?? process.env.PK_EMBED_MODEL ?? "nomic-embed-text";
  }

  get dimensions(): number {
    if (this.cachedDimensions) return this.cachedDimensions;
    return Number(process.env.PK_EMBED_DIMENSIONS) || 768;
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

  constructor(options?: {
    name?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    dimensions?: number;
  }) {
    this.name = options?.name ?? "openai";
    this.baseUrl = options?.baseUrl ?? process.env.PK_EMBED_URL ?? "https://api.openai.com/v1";
    this.model = options?.model ?? process.env.PK_EMBED_MODEL ?? "text-embedding-3-small";
    this.apiKey = options?.apiKey ?? process.env.PK_EMBED_API_KEY ?? null;
    this.dimensions = options?.dimensions ?? (Number(process.env.PK_EMBED_DIMENSIONS) || 1536);
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
  private cachedDimensions = 384;
  private pipeline: unknown = null;
  private loading: Promise<unknown> | null = null;
  private readonly model: string;

  constructor(model?: string) {
    this.model = model ?? process.env.PK_EMBED_MODEL ?? "Xenova/all-MiniLM-L6-v2";
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
    const backend = process.env.PK_EMBEDDINGS ?? "onnx";
    switch (backend) {
      case "openai":
        provider = new OpenAICompatibleProvider();
        break;
      case "llamacpp":
        provider = new OpenAICompatibleProvider({
          name: "llamacpp",
          baseUrl: "http://localhost:8080/v1",
          model: "default",
        });
        break;
      case "ollama":
        provider = new OllamaProvider();
        break;
      default:
        provider = new OnnxProvider();
        break;
    }
  }
  return provider;
}

export function setEmbeddingProvider(p: EmbeddingProvider) {
  provider = p;
}

export async function checkEmbeddingModel(): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.PK_EMBED_URL ?? "http://localhost:11434";
  const model = process.env.PK_EMBED_MODEL ?? "nomic-embed-text";

  try {
    const res = await fetch(`${url}/api/tags`);
    if (!res.ok) return { ok: false, error: `Ollama not responding (${res.status})` };

    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    const hasModel = models.some((m) => m.name === model || m.name.startsWith(`${model}:`));

    if (!hasModel) {
      return { ok: false, error: `Model ${model} not pulled. Run: ollama pull ${model}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: `Ollama not reachable at ${url}` };
  }
}
