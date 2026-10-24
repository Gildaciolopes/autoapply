import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { normalizeQuestion } from '@autoapply/apply';
import { closeRenderer } from '@autoapply/resume';
import { runApply } from '../src/apply/run.js';
import { db } from './helpers.js';
import { resetAll } from './jobs-helpers.js';
import { applyDeps, applyLlm, seedApplyPersona } from './apply-helpers.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  await closeRenderer();
});
beforeEach(resetAll);

const CAREERS = 'https://carreiras.empresa.example/vaga/42';

/** Company career form: standard fields + one question only the user can answer. */
const SIMPLE = `<!doctype html><html><head><title>Vaga</title></head><body><h1>Back-end</h1>
<form action="https://carreiras.empresa.example/enviar" method="post">
  <label for="nome">Nome completo *</label><input id="nome" name="nome" required>
  <label for="mail">E-mail *</label><input id="mail" type="email" name="email" required>
  <label for="cel">Celular</label><input id="cel" type="tel" name="celular">
  <label for="cv">Currículo (PDF) *</label><input id="cv" type="file" name="cv" accept=".pdf" required>
  <label for="origem">Como soube da vaga? *</label>
  <select id="origem" name="origem" required><option value="">Selecione</option><option>LinkedIn</option><option>Indicação</option><option>Site</option></select>
  <button type="submit">Enviar candidatura</button>
</form></body></html>`;

/** 3 steps shown by script; "Próximo" are type=button; the last step only has the submit. */
const MULTI = `<!doctype html><html><head><title>Candidatura</title><style>.s{display:none}.s.on{display:block}</style></head><body>
<form id="f" action="https://carreiras.empresa.example/enviar" method="post">
  <div class="s on" id="s1"><label for="n">Nome *</label><input id="n" name="n" required>
    <label for="e">E-mail *</label><input id="e" type="email" name="e" required>
    <button type="button" onclick="go(2)">Próximo</button></div>
  <div class="s" id="s2"><label for="sal">Pretensão salarial *</label><input id="sal" name="sal" required>
    <label for="k8s">Anos de experiência com Kubernetes *</label><input id="k8s" type="number" name="k8s" required>
    <button type="button" onclick="go(3)">Próximo</button></div>
  <div class="s" id="s3"><label for="cv">Currículo *</label><input id="cv" type="file" name="cv" required>
    <label for="em">E-mail *</label><input id="em" type="email" name="em" required>
    <button type="submit">Enviar candidatura</button></div>
</form>
<script>function go(n){document.querySelectorAll('.s').forEach(function(d){d.classList.remove('on')});document.getElementById('s'+n).classList.add('on');}</script>
</body></html>`;

const CAPTCHA = `<!doctype html><html><body><form><label for="n">Nome</label><input id="n" name="n">
<iframe title="reCAPTCHA" width="304" height="78" src="https://www.google.com/recaptcha/api2/anchor?k=abc&size=normal"></iframe>
<button type="submit">Enviar</button></form></body></html>`;

const FRAME_HOST = 'https://forms.ats-pequeno.example/apply/42';
const IFRAME_PAGE = `<!doctype html><html><body><h1>Trabalhe conosco</h1><iframe width="900" height="900" src="${FRAME_HOST}"></iframe></body></html>`;

async function run(url: string, pages: Record<string, string>, llm = applyLlm()) {
  const blobs: Record<string, Buffer> = {};
  const { app } = await seedApplyPersona(url);
  const deps = applyDeps(browser, [], { extra: pages, llm, blobs });
  const res = await runApply(deps, { applicationId: app.id, attempt: 1 }, { final: true });
  const row = await db.application.findUniqueOrThrow({ where: { id: app.id }, include: { answers: true, artifacts: true } });
  return { res, row, deps, app, blobs };
}

describe('generic filler (US4) and needs-input loop (US3)', { timeout: 120_000 }, () => {
  it('unanswerable question → needs_input; the user answer (memory) fills it on the next run', async () => {
    const first = await run(CAREERS, { [CAREERS]: SIMPLE });
    expect(first.row.ats).toBe('generic');
    expect(first.res.status).toBe('needs_input');
    expect(first.res.reasons).toEqual([expect.objectContaining({ fieldKey: '[id="origem"]' })]);
    expect(first.row.answers.find((a) => a.fieldKey === '[id="nome"]')).toMatchObject({ answer: 'Ana Beatriz Souza', filled: true });
    expect(first.row.answers.find((a) => a.fieldKey === '[id="cv"]')).toMatchObject({ source: 'anexo', filled: true });

    // What POST /applications/:id/answers stores (approved memory, source user).
    await db.answerMemory.create({ data: { question: 'Como soube da vaga? *', normalized: normalizeQuestion('Como soube da vaga? *'), answer: 'LinkedIn', fieldType: 'select', approved: true, source: 'user' } });
    await db.application.update({ where: { id: first.app.id }, data: { status: 'queued', attempts: 2 } });
    const res = await runApply(first.deps, { applicationId: first.app.id, attempt: 2 }, { final: true });
    expect(res.status).toBe('ready');
    const again = await db.formAnswer.findFirstOrThrow({ where: { applicationId: first.app.id, fieldKey: '[id="origem"]' } });
    expect(again).toMatchObject({ answer: 'LinkedIn', source: 'memória', filled: true });
  });

  it('multi-step: fills every step, one screenshot per step, stops before the final submit', async () => {
    const { res, row } = await run(CAREERS, { [CAREERS]: MULTI });
    expect((row.report as { steps: number }).steps).toBe(3);
    expect(row.artifacts.map((a) => a.label)).toEqual(['before', 'step-1', 'step-2', 'after']);
    expect((row.report as { submitAttempts: number }).submitAttempts).toBe(0);
    expect(row.answers.find((a) => a.fieldKey === '[id="k8s"]')).toMatchObject({ answer: '0', source: 'calculado', filled: true });
    expect(row.answers.find((a) => a.fieldKey === '[id="sal"]')).toMatchObject({ answer: 'R$ 15.000 mensal (CLT)', filled: true });
    // the e-mail asked again on step 3 gets the same answer
    expect(row.answers.find((a) => a.fieldKey === '[id="em"]')).toMatchObject({ answer: 'ana.souza@example.com', filled: true });
    expect(res.status).toBe('ready');
  });

  it('form inside a cross-origin iframe of a career page', async () => {
    const SIMPLE_IN_FRAME = SIMPLE.replace('carreiras.empresa.example/enviar', 'forms.ats-pequeno.example/submit');
    const { res, row } = await run(CAREERS, { [CAREERS]: IFRAME_PAGE, [FRAME_HOST]: SIMPLE_IN_FRAME });
    expect(row.answers.find((a) => a.fieldKey === '[id="mail"]')).toMatchObject({ answer: 'ana.souza@example.com', filled: true, frameUrl: FRAME_HOST });
    expect(res.status).toBe('needs_input'); // "Como soube da vaga?" again
  });

  it('visible captcha → needs_input captcha with the last screenshot; never solved', async () => {
    const { res, row } = await run(CAREERS, { [CAREERS]: CAPTCHA });
    expect(res.status).toBe('needs_input');
    expect(res.reasons[0]?.code).toBe('captcha');
    expect(row.artifacts.map((a) => a.label)).toEqual(['last']);
  });
});

describe('kill switch (US5)', { timeout: 120_000 }, () => {
  it('application cancelled mid-run → aborts, stays skipped, nothing submitted', async () => {
    const { app } = await seedApplyPersona(CAREERS);
    const deps = applyDeps(browser, [], { extra: { [CAREERS]: SIMPLE } });
    const put = deps.storage.put;
    // The user hits "Parar tudo" right after the "before" screenshot.
    deps.storage.put = async (k, b, t) => {
      await put(k, b, t);
      if (k.endsWith('/before.png')) await db.application.update({ where: { id: app.id }, data: { status: 'skipped' } });
    };
    const res = await runApply(deps, { applicationId: app.id, attempt: 1 }, { final: true });
    expect(res.status).toBe('skipped');
    const row = await db.application.findUniqueOrThrow({ where: { id: app.id }, include: { answers: true } });
    expect(row.status).toBe('skipped');
    expect(row.submittedAt).toBeNull();
    expect(row.answers).toEqual([]); // aborted before filling
  });

});
