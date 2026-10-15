import type { z } from 'zod';
import type { ChatMessage, LlmProvider } from './provider.js';

/**
 * Test double: returns recorded responses in call order (or via a responder fn).
 * Output still goes through the caller's Zod schema, like the real provider.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly calls: { messages: ChatMessage[]; model?: string }[] = [];

  constructor(
    private readonly responses: unknown[] | ((messages: ChatMessage[]) => unknown),
    private readonly embedder?: (texts: string[]) => number[][],
  ) {}

  async generateObject<T extends z.ZodType>(opts: {
    schema: T;
    messages: ChatMessage[];
    model?: string;
  }): Promise<z.infer<T>> {
    this.calls.push({ messages: opts.messages, model: opts.model });
    const raw = typeof this.responses === 'function' ? this.responses(opts.messages) : this.responses.shift();
    if (raw === undefined) throw new Error('FakeLlmProvider: no recorded response left');
    if (raw instanceof Error) throw raw;
    return opts.schema.parse(raw);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.embedder ? this.embedder(texts) : texts.map(() => []);
  }
}
