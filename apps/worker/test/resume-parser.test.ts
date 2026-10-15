import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '@autoapply/llm';
import { parseResume } from '../src/kb/resume-parser.js';
import { db, deps, json, reset, resumeFixture } from './helpers.js';

const recorded = json<Record<string, unknown> & { skills: unknown[] }>('llm/persona-ana.json');
/** Recorded real qwen3 output + one injected hallucination the PDF never mentions. */
const withHallucination = { ...recorded, skills: [...recorded.skills, { name: 'Kubernetes', quote: 'Kubernetes' }] };

async function upload(id: string, key: string) {
  await db.resumeBase.create({ data: { id, minioKey: key, fileName: 'cv.pdf' } });
}

beforeEach(reset);
afterAll(() => db.$disconnect());

describe('parseResume', () => {
  it('text PDF → review draft; hallucinated item flagged not_in_source', async () => {
    await upload('r1', 'resumes/r1/original.pdf');
    const d = deps([withHallucination], { 'resumes/r1/original.pdf': resumeFixture('persona-ana.pdf') });
    expect(await parseResume(d, 'r1', 'text')).toEqual({ status: 'review' });

    const row = await db.resumeBase.findUniqueOrThrow({ where: { id: 'r1' } });
    expect(row.status).toBe('review');
    expect(row.rawText).toContain('Xeno Tecnologia');
    const draft = row.parsed as { work: { name: string; startDate: unknown; endDate: unknown; flags: string[] }[]; skills: { name: string; flags: string[] }[] };
    expect(draft.work[0]).toMatchObject({ name: 'Xeno Tecnologia Ltda', startDate: { year: 2021, month: 3, precision: 'month' }, endDate: 'present', flags: [] });
    expect(draft.work[1]).toMatchObject({ startDate: { year: 2018, month: 6, precision: 'month' }, endDate: { year: 2021, month: 2, precision: 'month' } });
    const flagged = draft.skills.filter((s) => s.flags.includes('not_in_source')).map((s) => s.name);
    expect(flagged).toEqual(['Kubernetes']);
    expect(await db.fact.count()).toBe(0); // parsing never writes facts
  });

  it('image-only PDF → image_only without calling the LLM', async () => {
    await upload('r2', 'k2');
    const d = deps([], { k2: resumeFixture('persona-scan.pdf') });
    expect(await parseResume(d, 'r2', 'text')).toEqual({ status: 'image_only' });
    expect((await db.resumeBase.findUniqueOrThrow({ where: { id: 'r2' } })).status).toBe('image_only');
  });

  it('vision mode: transcription becomes the provenance text', async () => {
    await upload('r3', 'k3');
    const transcription = 'Ana Beatriz Souza\nXeno Tecnologia Ltda — Engenheira de Software Sênior mar 2021 – atual\nHabilidades: TypeScript';
    const raw = {
      lang: 'pt',
      basics: { name: 'Ana Beatriz Souza' },
      work: [{ company: 'Xeno Tecnologia Ltda', position: 'Engenheira de Software Sênior', start: 'mar 2021', end: 'atual', quote: 'Xeno' }],
      education: [],
      skills: [{ name: 'TypeScript', quote: 'TypeScript' }, { name: 'Go', quote: 'Go' }],
      languages: [],
      certificates: [],
      projects: [],
    };
    const d = deps([], { k3: resumeFixture('persona-scan.pdf') });
    let pages = 0;
    d.llm = new FakeLlmProvider((messages) => (messages.some((m) => m.images?.length) ? { text: pages++ === 0 ? transcription : '' } : raw));
    expect(await parseResume(d, 'r3', 'vision')).toEqual({ status: 'review' });
    const row = await db.resumeBase.findUniqueOrThrow({ where: { id: 'r3' } });
    expect(row.extraction).toBe('vision');
    expect(row.rawText).toContain(transcription);
    const skills = (row.parsed as { skills: { name: string; flags: string[] }[] }).skills;
    expect(skills.find((s) => s.name === 'Go')!.flags).toContain('not_in_source');
  });

  it('LLM failure → failed with error, rethrown for BullMQ retry', async () => {
    await upload('r4', 'k4');
    const d = deps([new Error('ollama down')], { k4: resumeFixture('persona-ana.pdf') });
    await expect(parseResume(d, 'r4', 'text')).rejects.toThrow('ollama down');
    const row = await db.resumeBase.findUniqueOrThrow({ where: { id: 'r4' } });
    expect(row).toMatchObject({ status: 'failed', error: 'ollama down' });
  });
});
