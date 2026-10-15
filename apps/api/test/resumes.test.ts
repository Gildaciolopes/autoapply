import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { usableFactsWhere } from '@autoapply/db';
import { ResumeDraft } from '@autoapply/shared';
import { ResumesService } from '../src/kb/resumes.service.js';
import type { StorageService } from '../src/kb/storage.service.js';
import { apiError, db, fakeQueue, fakeStorage, prisma, reset } from './helpers.js';

const pdf = readFileSync(new URL('../../../packages/resume/test/fixtures/persona-ana.pdf', import.meta.url));
const rawText = 'Ana Souza\nXeno · Engenheira de Software Sênior · mar 2021 – atual\nMigrei a API para NestJS\nTypeScript, React';
const draft = (over: Partial<ResumeDraft> = {}) =>
  ResumeDraft.parse({
    basics: { name: 'Ana Souza', email: 'ana@example.com' },
    work: [{ id: 'work-0', name: 'Xeno', position: 'Engenheira de Software', startDate: { year: 2021, month: 3, precision: 'month' }, endDate: 'present', highlights: ['Migrei a API para NestJS'] }],
    skills: [
      { id: 'skills-0', name: 'TypeScript' },
      { id: 'skills-1', name: 'React' },
      { id: 'skills-2', name: 'Kubernetes', flags: ['not_in_source'] },
    ],
    ...over,
  });

let queue: ReturnType<typeof fakeQueue>;
let svc: ResumesService;
beforeEach(async () => {
  await reset();
  queue = fakeQueue();
  svc = new ResumesService(prisma, fakeStorage() as unknown as StorageService, queue as never);
});
afterAll(() => db.$disconnect());

async function inReview(id: string, d = draft(), version = 1) {
  await db.resumeBase.create({ data: { id, minioKey: `resumes/${id}/original.pdf`, fileName: 'cv.pdf', status: 'review', rawText, parsed: d as never, version } });
}

describe('ResumesService', () => {
  it('upload validates PDF and enqueues parse_resume', async () => {
    expect(await apiError(svc.upload({ originalname: 'x.png', mimetype: 'image/png', size: 10, buffer: Buffer.from('PNG') }))).toMatchObject({ status: 415, code: 'not_pdf' });
    expect(await apiError(svc.upload({ originalname: 'x.pdf', mimetype: 'application/pdf', size: 6 * 1024 * 1024, buffer: pdf }))).toMatchObject({ status: 413 });
    const r = await svc.upload({ originalname: 'cv.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf });
    expect(r.status).toBe('uploaded');
    expect(queue.added[0]).toMatchObject({ name: 'parse_resume', data: { kind: 'parse_resume', resumeId: r.id, mode: 'text' } });
  });

  it('confirm refuses unresolved not_in_source items (422)', async () => {
    await inReview('r1');
    const e = await apiError(svc.confirm('r1', []));
    expect(e).toMatchObject({ status: 422, code: 'unresolved_flags', details: ['skills-2'] });
    expect(await db.fact.count()).toBe(0);
  });

  it('confirm turns the reviewed draft into verified facts with resume provenance', async () => {
    await inReview('r1', draft({ skills: draft().skills.slice(0, 2) }));
    const res = await svc.confirm('r1', []);
    expect(res).toMatchObject({ created: 3, conflicts: 0 });
    const facts = await db.fact.findMany({ include: { sources: true }, orderBy: { key: 'asc' } });
    expect(facts.map((f) => [f.key, f.verifiedByUser, f.sources[0]!.ref])).toEqual([
      ['experience:xeno:2021', true, 'resume:r1#work[0]'],
      ['skill:react', true, 'resume:r1#skills[1]'],
      ['skill:typescript', true, 'resume:r1#skills[0]'],
    ]);
    expect(await db.fact.count({ where: usableFactsWhere })).toBe(3);
    expect(await db.profile.findUnique({ where: { id: 'me' } })).toMatchObject({ fullName: 'Ana Souza', email: 'ana@example.com' });
    expect((await db.resumeBase.findUniqueOrThrow({ where: { id: 'r1' } })).status).toBe('confirmed');
  });

  it('user can keep a flagged item explicitly (acceptFlagged)', async () => {
    await inReview('r1');
    await svc.confirm('r1', ['skills-2']);
    expect(await db.fact.findUnique({ where: { kind_key: { kind: 'skill', key: 'skill:kubernetes' } } })).toMatchObject({ verifiedByUser: true });
  });

  it('user edit in review is what gets stored (US1 scenario 2)', async () => {
    await inReview('r1', draft({ skills: [] }));
    const edited = draft({ skills: [] });
    edited.work[0]!.position = 'Engenheira de Software Sênior';
    await svc.saveDraft('r1', edited);
    await svc.confirm('r1', []);
    const f = await db.fact.findFirstOrThrow({ where: { kind: 'experience' } });
    expect((f.value as { title: string }).title).toBe('Engenheira de Software Sênior');
  });

  it('re-upload: diff shown, confirm updates changed facts and flags removed ones (FR-009)', async () => {
    await inReview('r1', draft({ skills: draft().skills.slice(0, 2) }));
    await svc.confirm('r1', []);
    const v2 = draft({ skills: [{ id: 'skills-0', name: 'TypeScript', quote: '', flags: [] }] });
    v2.work[0]!.position = 'Engenheira de Software Sênior';
    await inReview('r2', v2, 2);
    const detail = await svc.get('r2');
    expect(detail.diff).toMatchObject({ added: [], unchanged: ['skills-0'], removed: [{ key: 'skill:react' }] });
    expect(detail.diff!.changed).toHaveLength(1);
    await svc.confirm('r2', []);
    const exp = await db.fact.findFirstOrThrow({ where: { kind: 'experience' }, include: { revisions: true } });
    expect((exp.value as { title: string }).title).toBe('Engenheira de Software Sênior');
    expect(exp.revisions.some((r) => r.action === 'edited')).toBe(true);
    const react = await db.fact.findFirstOrThrow({ where: { key: 'skill:react' } });
    expect(react).toMatchObject({ status: 'active', missingFrom: ['resume'] });
    expect(await db.resumeBase.count({ where: { active: true } })).toBe(1);
  });

  it('status guards (409)', async () => {
    await db.resumeBase.create({ data: { id: 'r9', minioKey: 'k', fileName: 'x.pdf', status: 'parsing' } });
    expect(await apiError(svc.confirm('r9', []))).toMatchObject({ status: 409 });
    expect(await apiError(svc.get('nope'))).toMatchObject({ status: 404 });
  });
});
