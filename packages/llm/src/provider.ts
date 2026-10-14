import type { z } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // base64, vision models only
}

export interface LlmProvider {
  readonly name: string;
  /** Structured output: response is JSON-schema constrained and Zod-validated. */
  generateObject<T extends z.ZodType>(opts: {
    schema: T;
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
  }): Promise<z.infer<T>>;
  embed(texts: string[], model?: string): Promise<number[][]>;
}
