import { z } from 'zod';
import type { ChatMessage, LlmProvider } from './provider.js';

export interface OllamaConfig {
  baseUrl: string; // http://host.docker.internal:11434 inside Docker, http://localhost:11434 on host
  chatModel: string;
  embedModel: string;
  timeoutMs?: number;
}

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  constructor(private readonly cfg: OllamaConfig) {}

  async generateObject<T extends z.ZodType>(opts: {
    schema: T;
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    numCtx?: number;
  }): Promise<z.infer<T>> {
    const content = await this.chatStream({
      model: opts.model ?? this.cfg.chatModel,
      messages: opts.messages,
      format: z.toJSONSchema(opts.schema),
      think: false,
      options: { temperature: opts.temperature ?? 0, ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}) },
    });
    return opts.schema.parse(JSON.parse(content));
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    const res = await this.post<{ embeddings: number[][] }>('/api/embed', {
      model: model ?? this.cfg.embedModel,
      input: texts,
    });
    return res.embeddings;
  }

  /**
   * /api/chat streamed (NDJSON) and concatenated. Non-streamed, Ollama sends headers only when the
   * whole answer is done, and Node's fetch drops the request after 5 min without headers
   * (undici headersTimeout) — long generations failed with "fetch failed".
   */
  private async chatStream(body: Record<string, unknown>): Promise<string> {
    const res = await this.request('/api/chat', { ...body, stream: true });
    if (!res.body) throw new Error('Ollama /api/chat: empty body');
    const decoder = new TextDecoder();
    let buf = '';
    let out = '';
    const line = (l: string) => {
      if (!l.trim()) return;
      const j = JSON.parse(l) as { message?: { content?: string }; error?: string };
      if (j.error) throw new Error(`Ollama /api/chat: ${j.error}`);
      out += j.message?.content ?? '';
    };
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        line(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
    line(buf + decoder.decode());
    return out;
  }

  private async post<R>(path: string, body: unknown): Promise<R> {
    return (await (await this.request(path, body)).json()) as R;
  }

  private async request(path: string, body: unknown): Promise<Response> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 300_000),
    });
    if (!res.ok) throw new Error(`Ollama ${path} ${res.status}: ${await res.text()}`);
    return res;
  }
}

export function ollamaFromEnv(env = process.env): OllamaProvider {
  return new OllamaProvider({
    baseUrl: env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    chatModel: env.OLLAMA_CHAT_MODEL ?? 'qwen3:8b',
    embedModel: env.OLLAMA_EMBED_MODEL ?? 'bge-m3',
    // Long resumes (verbatim bullets + one quoted entry per skill) take > 5 min on qwen3:8b.
    timeoutMs: Number(env.OLLAMA_TIMEOUT_MS) > 0 ? Number(env.OLLAMA_TIMEOUT_MS) : 900_000,
  });
}
