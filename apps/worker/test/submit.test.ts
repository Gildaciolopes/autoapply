import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { closeRenderer } from '@autoapply/resume';
import { runApply } from '../src/apply/run.js';
import { currentApprovalHash, runSubmit, type SubmitDeps } from '../src/apply/submit.js';
import type { FixtureServer } from '../src/apply/browser.js';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { applyDeps, seedApplyPersona } from './apply-helpers.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  await closeRenderer();
});
beforeEach(resetAll);

/** Local recording test form (FR-016): never a real platform. */
const JOB = 'https://test-ats.local.example/job/1';
const POST_URL = 'https://test-ats.local.example/apply';
const form = (extra = '', captcha = false) => `<!doctype html><html><body><h1>Vaga teste</h1>
<form action="${POST_URL}" method="post" enctype="multipart/form-data">
  <label for="nome">Nome completo *</label><input id="nome" name="nome" required>
  <label for="mail">E-mail *</label><input id="mail" type="email" name="email" required>
  <label for="cel">Celular *</label><input id="cel" type="tel" name="celular" required>
  <label for="sal">Pretensão salarial *</label><input id="sal" name="salario" required>
  <label for="cv">Currículo (PDF) *</label><input id="cv" type="file" name="cv" accept=".pdf" required>
  ${extra}
  ${captcha ? '<div class="g-recaptcha" data-sitekey="test" style="width:304px;height:78px;border:1px solid #999">captcha</div>' : ''}
  <button type="submit">Enviar candidatura</button>
</form></body></html>`;

function server(state: { page: string; confirm: boolean; posts: string[] }): FixtureServer {
  return (url, method, body) => {
    if (url.startsWith(POST_URL) && method === 'POST') {
      state.posts.push(body ?? '');
      return { body: state.confirm ? '<html><body><h1>Thank you for applying!</h1></body></html>' : '<html><body>ok</body></html>', contentType: 'text/html; charset=utf-8' };
    }
    if (url.startsWith(JOB) && method === 'GET') return { body: state.page, contentType: 'text/html; charset=utf-8' };
    return null;
  };
}

/** Prepare in dry-run, then approve as the API does (status approved + approval hash). */
async function prepared(state: { page: string; confirm: boolean; posts: string[] }) {
  const { app } = await seedApplyPersona(JOB);
  const blobs: Record<string, Buffer> = {};
  const deps = { ...applyDeps(browser, [], { blobs }), serve: server(state) } as SubmitDeps;
  const res = await runApply(deps, { applicationId: app.id, attempt: 1 }, { final: true });
  expect(res, JSON.stringify(res.reasons)).toMatchObject({ status: 'ready' });
  expect(state.posts).toEqual([]); // dry-run never posts
  const hash = await currentApprovalHash(deps, app.id);
  await db.application.update({ where: { id: app.id }, data: { status: 'approved', approvedAt: new Date(), approvalHash: hash } });
  return { app, deps, hash, blobs };
}

const row = (id: string) => db.application.findUniqueOrThrow({ where: { id }, include: { artifacts: true } });

describe('submit path (US3, FR-007..FR-010)', { timeout: 120_000 }, () => {
  it('approved → exactly one POST with the approved values; confirmation; second run is a no-op', async () => {
    const state = { page: form(), confirm: true, posts: [] as string[] };
    const { app, deps, hash } = await prepared(state);
    const r = await runSubmit(deps, { applicationId: app.id, approvalHash: hash });
    expect(r.status).toBe('submitted');
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0]).toContain('Ana Beatriz Souza');
    expect(state.posts[0]).toContain('ana.souza@example.com');
    expect(state.posts[0]).toContain('R$ 15.000 mensal (CLT)');
    expect(state.posts[0]).toContain('application/pdf');
    const a = await row(app.id);
    expect(a).toMatchObject({ status: 'submitted', submittedVia: 'auto' });
    expect(a.submittedAt).not.toBeNull();
    expect((a.sentValues as { fieldKey: string }[]).map((x) => x.fieldKey)).toEqual(expect.arrayContaining(['[id="nome"]', '[id="cv"]']));
    expect(a.artifacts.map((x) => x.label)).toEqual(expect.arrayContaining(['submit-filled', 'confirmation']));
    expect((await runSubmit(deps, { applicationId: app.id, approvalHash: hash })).status).toBe('noop');
    expect(state.posts).toHaveLength(1);
  });

  it('approved answers changed after approval → form_changed, nothing sent', async () => {
    const state = { page: form(), confirm: true, posts: [] as string[] };
    const { app, deps, hash } = await prepared(state);
    await db.formAnswer.updateMany({ where: { applicationId: app.id, fieldKey: '[id="sal"]' }, data: { answer: 'R$ 99.000' } });
    const r = await runSubmit(deps, { applicationId: app.id, approvalHash: hash });
    expect(r.reasons[0]?.code).toBe('form_changed');
    expect(state.posts).toEqual([]);
    expect((await row(app.id)).status).toBe('needs_input');
  });

  it('a new required question on the live form → new_step, nothing sent', async () => {
    const state = { page: form(), confirm: true, posts: [] as string[] };
    const { app, deps, hash } = await prepared(state);
    state.page = form('<label for="cpf">CPF *</label><input id="cpf" name="cpf" required>');
    const r = await runSubmit(deps, { applicationId: app.id, approvalHash: hash });
    expect(r.reasons[0]?.code).toBe('new_step');
    expect(r.reasons[0]?.message).toContain('CPF');
    expect(state.posts).toEqual([]);
  });

  it('kill switch before the compare-and-set → nothing sent', async () => {
    const state = { page: form(), confirm: true, posts: [] as string[] };
    const { app, deps, hash } = await prepared(state);
    const put = deps.storage.put;
    deps.storage.put = async (k, b, t) => {
      await put(k, b, t);
      if (k.endsWith('/submit-filled.png')) await db.application.update({ where: { id: app.id }, data: { status: 'ready', approvedAt: null } });
    };
    const r = await runSubmit(deps, { applicationId: app.id, approvalHash: hash });
    expect(r.status).toBe('noop');
    expect(state.posts).toEqual([]);
    expect((await row(app.id)).status).toBe('ready');
  });

  it('no confirmation → submit_uncertain, never resubmitted', async () => {
    const state = { page: form(), confirm: false, posts: [] as string[] };
    const { app, deps, hash } = await prepared(state);
    const r = await runSubmit({ ...deps, confirmWaitMs: 2000 }, { applicationId: app.id, approvalHash: hash });
    expect(r.status).toBe('submit_uncertain');
    expect(state.posts).toHaveLength(1);
    expect((await runSubmit(deps, { applicationId: app.id, approvalHash: hash })).status).toBe('noop');
    expect(state.posts).toHaveLength(1);
  });
});

describe('assisted submit (US4, FR-011)', { timeout: 120_000 }, () => {
  it('captcha at submit → assisted: the user clicks submit, the system only watches', async () => {
    const state = { page: form(), confirm: true, posts: [] as string[] };
    const { app, deps, hash } = await prepared(state);
    state.page = form('', true);
    const first = await runSubmit(deps, { applicationId: app.id, approvalHash: hash });
    expect(first.status).toBe('assisted_required');
    expect(state.posts).toEqual([]);
    expect((await row(app.id)).status).toBe('approved');

    let userClicked = false;
    const r = await runSubmit(
      {
        ...deps,
        headedBrowser: () => chromium.launch({ headless: true }),
        userAction: async (page) => {
          await page.waitForSelector('#__autoapply_banner');
          userClicked = true;
          await page.click('button[type="submit"]');
        },
      },
      { applicationId: app.id, approvalHash: hash },
      { assisted: true },
    );
    expect(userClicked).toBe(true);
    expect(r.status).toBe('submitted');
    expect(state.posts).toHaveLength(1);
    expect((await row(app.id)).submittedVia).toBe('assisted');
  });

  it('user does not finish → human_check, nothing sent', async () => {
    const state = { page: form(), confirm: true, posts: [] as string[] };
    const { app, deps, hash } = await prepared(state);
    state.page = form('', true);
    const r = await runSubmit({ ...deps, headedBrowser: () => chromium.launch({ headless: true }), assistedWaitMs: 1500 }, { applicationId: app.id, approvalHash: hash }, { assisted: true });
    expect(r.reasons[0]?.code).toBe('human_check');
    expect(state.posts).toEqual([]);
    expect((await row(app.id)).status).toBe('needs_input');
  });
});
