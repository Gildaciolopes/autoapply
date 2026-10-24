import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { closeRenderer } from '@autoapply/resume';
import { runApply } from '../src/apply/run.js';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { applyDeps, platformPage, seedApplyPersona, seedPlatformSession } from './apply-helpers.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  await closeRenderer();
});
beforeEach(resetAll);

const GUPY_JOB = 'https://acme.gupy.io/jobs/9876543';
const GUPY_APPLY = 'https://acme.gupy.io/candidates/jobs/9876543/apply';
const LI_JOB = 'https://www.linkedin.com/jobs/view/4012345678/';
const EXTERNAL = 'https://carreiras.beta.example/vaga/7';
const SIMPLE = `<!doctype html><html><body><form action="${EXTERNAL}/enviar" method="post">
<label for="nome">Nome completo *</label><input id="nome" required><label for="mail">E-mail *</label><input id="mail" type="email" required>
<button type="submit">Enviar candidatura</button></form></body></html>`;

async function simulate(url: string, pages: Record<string, string>) {
  const { app } = await seedApplyPersona(url);
  const blobs: Record<string, Buffer> = {};
  const res = await runApply(applyDeps(browser, [], { extra: pages, blobs }), { applicationId: app.id, attempt: 1 }, { final: true });
  const row = await db.application.findUniqueOrThrow({ where: { id: app.id }, include: { answers: true, artifacts: true } });
  return { res, row };
}
const ans = (row: Awaited<ReturnType<typeof simulate>>['row'], key: string) => row.answers.find((a) => a.fieldKey === key);
const report = (row: Awaited<ReturnType<typeof simulate>>['row']) => row.report as { submitAttempts: number; steps: number; blockedRequests: { method: string }[] };

describe('logged-in platforms in dry-run (US2)', { timeout: 120_000 }, () => {
  it('Gupy: job page → apply flow, 3 steps, prefilled name replaced by the fact, nothing submitted', async () => {
    await seedPlatformSession('gupy');
    const { res, row } = await simulate(GUPY_JOB, { [GUPY_JOB]: platformPage('gupy-job.html'), [GUPY_APPLY]: platformPage('gupy-apply.html') });
    expect(row.platform).toBe('gupy');
    expect(res.status).toBe('ready');
    expect(report(row)).toMatchObject({ steps: 3, submitAttempts: 0 });
    expect(row.artifacts.map((a) => a.label)).toEqual(['before', 'step-1', 'step-2', 'after']);
    expect(ans(row, '[id="name"]')).toMatchObject({ answer: 'Ana Beatriz Souza', filled: true });
    expect(ans(row, '[id="cv"]')).toMatchObject({ source: 'anexo', filled: true });
    expect(ans(row, 'input[type="radio"][name="q_nest"]')).toMatchObject({ answer: 'Sim', source: 'regra', filled: true });
    expect(ans(row, '[id="q_level"]')).toMatchObject({ answer: 'Intermediário', filled: true });
  });

  it('LinkedIn Easy Apply: modal only, 4 steps, follow-company unchecked, final submit never clicked', async () => {
    await seedPlatformSession('linkedin');
    const { res, row } = await simulate(LI_JOB, { [LI_JOB]: platformPage('linkedin-job.html') });
    expect(row.platform).toBe('linkedin');
    expect(['ready', 'needs_input']).toContain(res.status);
    expect(row.answers.some((a) => /pesquisar/i.test(a.question))).toBe(false); // page search box is outside the modal
    expect(ans(row, '[id="em"]')).toMatchObject({ answer: 'ana.souza@example.com', filled: true });
    expect(ans(row, 'input[type="checkbox"][name="follow"]')).toMatchObject({ answer: 'false', source: 'regra', filled: true });
    expect(report(row)).toMatchObject({ steps: 4, submitAttempts: 0 });
    expect(row.answers.filter((a) => a.fieldKey === '[id="up"]')).toEqual([expect.objectContaining({ source: 'anexo', filled: true, step: 1 })]); // only on its own step
  });

  it('LinkedIn without Easy Apply → employer form through the F4 engine', async () => {
    await seedPlatformSession('linkedin');
    const { row } = await simulate(LI_JOB, { [LI_JOB]: platformPage('linkedin-external.html'), [EXTERNAL]: SIMPLE });
    expect(ans(row, '[id="mail"]')).toMatchObject({ answer: 'ana.souza@example.com', filled: true });
    expect(row.ats).toBe('generic');
  });

  it('already applied, missing session and login wall', async () => {
    await seedPlatformSession('gupy');
    const already = await simulate(GUPY_JOB, { [GUPY_JOB]: platformPage('gupy-already.html') });
    expect(already.res.status).toBe('already_applied');
    expect(already.row.status).toBe('already_applied');

    await resetAll();
    const none = await simulate(GUPY_JOB, {}); // no session at all
    expect(none.res.reasons[0]?.code).toBe('session_expired');

    await resetAll();
    await seedPlatformSession('linkedin');
    const wall = await simulate(LI_JOB, { [LI_JOB]: platformPage('linkedin-authwall.html') });
    expect(wall.res.reasons[0]?.code).toBe('session_expired');
    expect((await db.platform.findUniqueOrThrow({ where: { kind: 'linkedin' } })).sessionStatus).toBe('expired');
  });
});
