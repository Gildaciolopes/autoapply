import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OllamaProvider } from '@autoapply/llm';

// A fake Ollama /api/chat that streams NDJSON in pieces split mid-line, like the real server.
let url = '';
let lastBody: Record<string, unknown> = {};
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    lastBody = JSON.parse(raw) as Record<string, unknown>;
    const msgs = (lastBody.messages as { content: string }[])[0]!.content;
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    if (msgs === 'error') {
      res.end(`${JSON.stringify({ error: 'model not found' })}\n`);
      return;
    }
    const parts = ['{"name":', '"Gildácio",', '"skills":["NestJS"]}'];
    const lines = parts.map((p) => `${JSON.stringify({ message: { role: 'assistant', content: p }, done: false })}\n`).join('') + `${JSON.stringify({ done: true })}\n`;
    const chunks = [lines.slice(0, 17), lines.slice(17, 80), lines.slice(80)];
    let i = 0;
    const next = () => (i < chunks.length ? res.write(chunks[i++], () => setTimeout(next, 5)) : res.end());
    next();
  });
});

beforeAll(async () => {
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

describe('OllamaProvider.generateObject (streamed)', () => {
  const llm = () => new OllamaProvider({ baseUrl: url, chatModel: 'qwen3:8b', embedModel: 'bge-m3', timeoutMs: 5000 });
  const schema = z.object({ name: z.string(), skills: z.array(z.string()) });

  it('asks for a stream and joins chunks split mid-line', async () => {
    expect(await llm().generateObject({ schema, messages: [{ role: 'user', content: 'x' }] })).toEqual({ name: 'Gildácio', skills: ['NestJS'] });
    expect(lastBody).toMatchObject({ stream: true, think: false, model: 'qwen3:8b' });
  });

  it('surfaces an in-stream error', async () => {
    await expect(llm().generateObject({ schema, messages: [{ role: 'user', content: 'error' }] })).rejects.toThrow(/model not found/);
  });
});
