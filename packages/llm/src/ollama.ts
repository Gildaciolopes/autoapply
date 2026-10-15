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
    const res = await this.post<{ message: { content: string } }>('/api/chat', {
      model: opts.model ?? this.cfg.chatModel,
      messages: opts.messages,
      format: z.toJSONSchema(opts.schema),
      stream: false,
      think: false,
      options: { temperature: opts.temperature ?? 0, ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}) },
    });
    return opts.schema.parse(JSON.parse(res.message.content));
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    const res = await this.post<{ embeddings: number[][] }>('/api/embed', {
      model: model ?? this.cfg.embedModel,
      input: texts,
    });
    return res.embeddings;
  }

  private async post<R>(path: string, body: unknown): Promise<R> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 300_000),
    });
    if (!res.ok) throw new Error(`Ollama ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as R;
  }
}

export function ollamaFromEnv(env = process.env): OllamaProvider {
  return new OllamaProvider({
    baseUrl: env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    chatModel: env.OLLAMA_CHAT_MODEL ?? 'qwen3:8b',
    embedModel: env.OLLAMA_EMBED_MODEL ?? 'bge-m3',
  });
}
