import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { closeRenderer } from '@autoapply/resume';
import { runApply } from '../src/apply/run.js';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { applyDeps, meta, seedApplyPersona } from './apply-helpers.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  await closeRenderer();
});
beforeEach(resetAll);

const STANDARD_KEYS = /first_name|last_name|email|phone|resume/;

async function simulate(name: string, applyUrl: string, extra: Record<string, string> = {}) {
  const { app } = await seedApplyPersona(applyUrl);
  const blobs: Record<string, Buffer> = {};
  const res = await runApply(applyDeps(browser, [name], { extra, blobs }), { applicationId: app.id, attempt: 1 }, { final: true });
  const row = await db.application.findUniqueOrThrow({ where: { id: app.id }, include: { answers: true, artifacts: true } });
  return { res, row, blobs };
}

function expectDryRunProof(row: Awaited<ReturnType<typeof simulate>>['row'], blobs: Record<string, Buffer>) {
  const report = row.report as { submitAttempts: number; blockedRequests: { method: string }[] };
  expect(report.submitAttempts).toBe(0);
  expect(row.submittedAt).toBeNull();
  const labels = row.artifacts.map((a) => a.label);
  expect(labels).toEqual(expect.arrayContaining(['before', 'after']));
  for (const a of row.artifacts) expect(blobs[a.minioKey]?.subarray(1, 4).toString()).toBe('PNG');
}

const byLabel = (row: Awaited<ReturnType<typeof simulate>>['row'], re: RegExp) => row.answers.find((a) => re.test(a.question));

describe('apply engine on real form snapshots (US1, FR-001)', { timeout: 120_000 }, () => {
  it('Greenhouse board', async () => {
    const m = meta('greenhouse-board');
    const { res, row, blobs } = await simulate('greenhouse-board', m.url);
    expect(row.ats).toBe('greenhouse');
    expect(['ready', 'needs_input']).toContain(res.status);
    expectDryRunProof(row, blobs);
    expect(byLabel(row, /first name|nome/i)).toMatchObject({ answer: 'Ana', filled: true, source: 'fato' });
    expect(byLabel(row, /last name|sobrenome/i)).toMatchObject({ answer: 'Beatriz Souza', filled: true });
    expect(byLabel(row, /^e-?mail/i)).toMatchObject({ answer: 'ana.souza@example.com', filled: true });
    const resume = row.answers.find((a) => a.fieldType === 'file' && /resume|curr[ií]culo|cv/i.test(a.question));
    expect(resume).toMatchObject({ source: 'anexo', filled: true });
    // Contact fields and the resume are never what blocks the simulation.
    const contact = row.answers.filter((a) => STANDARD_KEYS.test(a.fieldKey));
    expect(contact.length).toBeGreaterThanOrEqual(5);
    for (const a of contact) expect(a.blocking).toBe(false);
    // Questions the facts cannot answer (family at the company, consent, demographics) wait for the user.
    expect(res.status).toBe('needs_input');
    expect(row.preparedAt).toBeInstanceOf(Date); // F7 funnel stage "prepared"
    expect(row.answers.find((a) => /family members/i.test(a.question))).toMatchObject({ answer: null, blocking: true });
    expect(row.answers.find((a) => /data privacy/i.test(a.question))).toMatchObject({ answer: null, blocking: true });
  });

  it('Greenhouse embedded in a company page (iframe)', async () => {
    const m = meta('greenhouse-embed');
    const jobId = new URL(m.url).searchParams.get('token');
    const company = `https://careers.vtex.example/vaga?gh_jid=${jobId}`;
    const html = `<!doctype html><html><body><h1>Vaga</h1><div id="grnhse_app"><iframe id="grnhse_iframe" width="100%" height="2400" src="${m.url}"></iframe></div>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=vtex"></script></body></html>`;
    const { res, row, blobs } = await simulate('greenhouse-embed', company, { [company]: html });
    expect(row.ats).toBe('greenhouse');
    expect(['ready', 'needs_input']).toContain(res.status);
    expectDryRunProof(row, blobs);
    expect(byLabel(row, /^e-?mail/i)).toMatchObject({ answer: 'ana.souza@example.com', filled: true });
    expect(row.answers.find((a) => a.fieldType === 'file' && /resume|curr[ií]culo|cv/i.test(a.question))).toMatchObject({ filled: true });
    expect(row.answers.every((a) => a.frameUrl?.includes('greenhouse.io'))).toBe(true);
  });

  it('Lever', async () => {
    const m = meta('lever-apply');
    const { res, row, blobs } = await simulate('lever-apply', m.url.replace(/\/apply$/, ''));
    expect(row.ats).toBe('lever');
    expect(['ready', 'needs_input']).toContain(res.status);
    expectDryRunProof(row, blobs);
    expect(byLabel(row, /full name|nome/i)).toMatchObject({ answer: 'Ana Beatriz Souza', filled: true });
    expect(byLabel(row, /^e-?mail/i)).toMatchObject({ answer: 'ana.souza@example.com', filled: true });
    expect(byLabel(row, /phone|telefone/i)).toMatchObject({ answer: '+55 11 98765-4321', filled: true });
    expect(byLabel(row, /linkedin/i)).toMatchObject({ answer: 'https://www.linkedin.com/in/ana-souza-example', filled: true });
    expect(row.answers.find((a) => a.fieldType === 'file' && /resume|curr[ií]culo|cv/i.test(a.question))).toMatchObject({ filled: true });
  });

  it('Ashby', async () => {
    const m = meta('ashby-application');
    const { res, row, blobs } = await simulate('ashby-application', m.url.replace(/\/application$/, ''));
    expect(row.ats).toBe('ashby');
    expect(['ready', 'needs_input']).toContain(res.status);
    expectDryRunProof(row, blobs);
    expect(byLabel(row, /name|nome/i)).toMatchObject({ answer: 'Ana Beatriz Souza', filled: true });
    expect(byLabel(row, /^e-?mail/i)).toMatchObject({ answer: 'ana.souza@example.com', filled: true });
    expect(row.answers.find((a) => a.fieldKey.includes('_systemfield_resume'))).toMatchObject({ filled: true });
    // Toggle-button yes/no widgets are fields too (answered by the language rule, never the model).
    expect(byLabel(row, /proficient in a written and spoken level in English/i)).toMatchObject({ answer: 'No', source: 'regra', filled: true, required: true });
    expect(res.status).toBe('needs_input'); // "Do you use AI coding agents…?" is for the user
    // The "Autofill from resume" uploader is never fed (the ATS would parse the file).
    expect(row.answers.find((a) => /autofill/i.test(a.question))).toMatchObject({ filled: false });
  });

  it('closed posting → failed job_closed', async () => {
    const url = 'https://jobs.lever.co/neon/00000000-0000-4000-8000-000000000000';
    const { app } = await seedApplyPersona(url);
    const res = await runApply(applyDeps(browser, []), { applicationId: app.id, attempt: 1 }, { final: true });
    expect(res.status).toBe('failed');
    expect(res.reasons[0]?.code).toBe('job_closed');
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).preparedAt).toBeNull();
  });
});
