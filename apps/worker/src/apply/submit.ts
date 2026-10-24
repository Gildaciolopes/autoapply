import type { Browser, BrowserContext, Frame, Page } from 'playwright';
import { REASON_LABELS, approvalHash, detectAts, detectBlockers, isSubmittedConfirmation, platformOf, type DetectedAts } from '@autoapply/apply';
import type { Prisma } from '@autoapply/db';
import type { NeedsReason, NeedsReasonCode, SubmitPayload } from '@autoapply/shared';
import { AdapterRedirect, AdapterStop, adapterFor, type Adapter } from './adapters/index.js';
import { ensureTailored, letterFile, loadTailorBasics, resumeFile } from './attachments.js';
import { screenshot, type FixtureServer, type StorageState } from './browser.js';
import { extractFields, snapshotForBlockers, type ExtractedField } from './extract.js';
import { attachFile, fillField, findSubmitControl, nextStep } from './fill.js';
import { recordPlatformError, recordPlatformOk } from './gate.js';
import { loadStorageState, markSessionExpired } from './sessions.js';
import type { ApplyDeps } from './run.js';

/**
 * THE ONLY CODE THAT SUBMITS APPLICATIONS (specs/005 research R5). It never answers anything new: it
 * re-opens the form, verifies it matches what the user approved, fills exactly the approved values,
 * flips the application to `submitting` with a compare-and-set and clicks the submit control once.
 */

export interface SubmitDeps extends ApplyDeps {
  /** Visible browser for assisted submit (user completes captcha / human check). */
  headedBrowser?: () => Promise<Browser>;
  /** Assisted wait (default 15 min). */
  assistedWaitMs?: number;
  /** Confirmation wait after the click (default 30 s). */
  confirmWaitMs?: number;
  /** Tests only: acts as the user in assisted mode. */
  userAction?: (page: Page) => Promise<void>;
}

export type SubmitStatus = 'submitted' | 'submit_uncertain' | 'needs_input' | 'noop' | 'assisted_required' | 'delayed';

export interface SubmitResult {
  status: SubmitStatus;
  reasons: NeedsReason[];
}

const MAX_STEPS = 6;
const RESUME_TEXT = /^curr[ií]culo adaptado/;
const LETTER_TEXT = /^carta de apresenta/;

/** Context WITHOUT the dry-run guard or submit trap: it must be able to submit (separate from F4). */
export async function openSubmitContext(browser: Browser, opts: { serve?: FixtureServer; storageState?: StorageState } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    storageState: opts.storageState,
  });
  if (opts.serve) {
    const serve = opts.serve;
    await context.route('**/*', async (route) => {
      const r = serve(route.request().url(), route.request().method(), route.request().postData());
      return r ? route.fulfill({ status: r.status ?? 200, contentType: r.contentType, body: r.body }) : route.abort();
    });
  }
  return { context, page: await context.newPage() };
}

const pageText = async (page: Page) => {
  const parts = await Promise.all(page.frames().map((f) => f.evaluate('document.body ? document.body.innerText : ""').catch(() => '')));
  return parts.map(String).join('\n');
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

async function openForm(page: Page, startUrl: string): Promise<{ adapter: Adapter; frame: Frame; detected: DetectedAts }> {
  let detected = detectAts(startUrl);
  if (detected.ats === 'generic') {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    const byHtml = detectAts(page.url(), await page.content());
    if (byHtml.ats !== 'generic') detected = byHtml;
  }
  let adapter = adapterFor(detected.ats);
  const getJson = async () => null;
  for (let hop = 0; hop < 3; hop++) {
    try {
      return { adapter, frame: await adapter.locate({ page, detected, getJson }), detected };
    } catch (e) {
      if (!(e instanceof AdapterRedirect) || hop === 2) throw e;
      detected = detectAts(e.url);
      if (detected.ats === 'generic') await page.goto(e.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      adapter = adapterFor(detected.ats);
    }
  }
  throw new Error('form not found');
}

/** Approval fingerprint recomputed from the DB (answers + tailored docs + form URL). */
export async function currentApprovalHash(deps: ApplyDeps, applicationId: string): Promise<string> {
  const app = await deps.db.application.findUniqueOrThrow({ where: { id: applicationId }, include: { answers: true } });
  const docs = await deps.db.tailoredDocument.findMany({ where: { id: { in: app.tailoredDocIds } }, select: { id: true, updatedAt: true } });
  return approvalHash({ formUrl: app.formUrl, answers: app.answers.map((a) => ({ fieldKey: a.fieldKey, answer: a.answer })), docs });
}

export async function runSubmit(deps: SubmitDeps, payload: SubmitPayload, opts: { assisted?: boolean } = {}): Promise<SubmitResult> {
  const { db } = deps;
  const appId = payload.applicationId;
  const app = await db.application.findUniqueOrThrow({ where: { id: appId }, include: { job: true, answers: true } });
  // Idempotency (FR-009): anything already sent / being sent / uncertain is never touched again.
  if (app.status !== 'approved') return { status: 'noop', reasons: [] };

  const event = (level: 'info' | 'warn' | 'error', message: string, data?: unknown) =>
    db.runEvent.create({ data: { queue: 'apply', applicationId: appId, level, message: `submit: ${message}`, data: data === undefined ? undefined : (data as Prisma.InputJsonValue) } });
  const attempt = app.attempts;
  const artifacts: { type: string; label: string; key: string }[] = [];
  const shot = async (page: Page, type: string, label: string) => {
    const key = `applications/${appId}/${attempt}/${label}.png`;
    await deps.storage.put(key, await screenshot(page), 'image/png');
    artifacts.push({ type, label, key });
  };
  const saveArtifacts = () =>
    artifacts.length
      ? db.artifact.createMany({ data: artifacts.map((a) => ({ applicationId: appId, type: a.type, label: a.label, attempt, minioKey: a.key })) })
      : Promise.resolve();
  /** Back to the user without sending (approval cleared: what was approved no longer applies). */
  const stop = async (code: NeedsReasonCode, message?: string, fromStatus: 'approved' | 'submitting' = 'approved') => {
    const reason: NeedsReason = { code, message: message ?? REASON_LABELS[code] };
    await saveArtifacts();
    await db.application.updateMany({
      where: { id: appId, status: fromStatus },
      data: { status: 'needs_input', needsReasons: [reason] as never, needsReason: reason.message, approvedAt: null, approvalHash: code === 'human_check' ? app.approvalHash : null },
    });
    await event('warn', `stopped: ${code}`);
    return { status: 'needs_input' as const, reasons: [reason] };
  };

  // 1. The approval still matches what is in the DB.
  const hash = await currentApprovalHash(deps, appId);
  if (!app.approvalHash || hash !== app.approvalHash || hash !== payload.approvalHash) return stop('form_changed', 'o que foi aprovado mudou: simule e aprove de novo');

  const platform = platformOf(app.platform ?? app.ats);
  let storageState: StorageState | null = null;
  if (platform === 'gupy' || platform === 'linkedin') {
    storageState = await loadStorageState(deps, platform);
    if (!storageState) return stop('session_expired', `${REASON_LABELS.session_expired} (${platform})`);
  }

  // Attachments re-rendered from the same tailored documents (their updatedAt is part of the hash).
  const basics = await loadTailorBasics(db, app.jobId);
  const resume = await ensureTailored(deps, app.jobId, 'resume');
  if (!resume.ok || !app.tailoredDocIds.includes(resume.doc.id)) return stop('form_changed', 'o currículo adaptado mudou: simule e aprove de novo');
  const resumePdf = await resumeFile(basics, resume.doc);
  const letterDoc = await db.tailoredDocument.findUnique({ where: { jobId_kind: { jobId: app.jobId, kind: 'cover_letter' } } });
  const letter = letterDoc && app.tailoredDocIds.includes(letterDoc.id) ? await letterFile(basics, letterDoc) : null;

  const browser = opts.assisted ? await (deps.headedBrowser ?? deps.browser)() : await deps.browser();
  const { context, page } = await openSubmitContext(browser, { serve: deps.serve, storageState: storageState ?? undefined });
  const sent: { fieldKey: string; question: string; value: string }[] = [];
  let clicked = false;
  try {
    await event('info', opts.assisted ? 'assisted run' : 'run');
    const { adapter, frame: first } = await openForm(page, app.job.applyUrl ?? app.job.url);
    let frame = first;
    const byStep = new Map<number, typeof app.answers>();
    for (const a of app.answers) byStep.set(a.step, [...(byStep.get(a.step) ?? []), a]);

    // 2. Per step: verify → fill exactly the approved values → next.
    for (let step = 0; step < MAX_STEPS; step++) {
      const fields = await extractFields(frame, step, adapter.scope);
      const byKey = new Map<string, ExtractedField>(fields.map((f) => [f.key, f]));
      const approved = byStep.get(step) ?? [];
      const approvedKeys = new Set(approved.map((a) => a.fieldKey));
      for (const a of approved) {
        const f = byKey.get(a.fieldKey);
        if (!f) {
          if (a.answer !== null) return stop('form_changed', `campo "${a.question}" não existe mais`);
          continue;
        }
        if (f.options.length && a.options.length && !sameSet(f.options, a.options)) return stop('form_changed', `opções de "${a.question}" mudaram`);
      }
      const unknown = fields.filter((f) => f.required && !approvedKeys.has(f.key) && !(f.combobox && !f.options.length && approved.length === 0));
      if (unknown.length) return stop('new_step', `perguntas novas sem resposta aprovada: ${unknown.map((f) => `"${f.label}"`).join(', ')}`);
      const blank = approved.filter((a) => a.required && a.answer === null);
      if (blank.length) return stop('form_changed', `obrigatórias sem resposta: ${blank.map((a) => `"${a.question}"`).join(', ')}`);

      for (const a of approved) {
        const f = byKey.get(a.fieldKey);
        if (!f || a.answer === null) continue;
        let ok: boolean;
        if (a.source === 'anexo' && RESUME_TEXT.test(a.answer)) ok = resumePdf ? await attachFile(frame, f, resumePdf) : false;
        else if (a.source === 'anexo' && LETTER_TEXT.test(a.answer)) ok = letter ? (f.type === 'file' ? await attachFile(frame, f, letter.file) : await fillField(frame, f, letter.text)) : false;
        else ok = await fillField(frame, f, f.multiple ? a.answer.split(/\s*;\s*/) : a.answer);
        if (!ok && a.required) return stop('form_changed', `não foi possível preencher "${a.question}"`);
        if (ok) sent.push({ fieldKey: a.fieldKey, question: a.question, value: a.answer });
      }
      await shot(page, 'screenshot_submit_step', `submit-step-${step}`);
      if (!(await nextStep(frame, adapter.scope))) break;
      frame = (await openFormFrame(adapter, page)) ?? frame;
    }
    await shot(page, 'screenshot_filled_submit', 'submit-filled');

    // 3. Human check visible before sending → assisted submit (never solved).
    const before = detectBlockers(await snapshotForBlockers(page, 1));
    if (before.blocker === 'captcha' || before.blocker === 'bot_protection') {
      if (!opts.assisted) {
        await saveArtifacts();
        await event('warn', 'human check before submit: assisted required');
        return { status: 'assisted_required', reasons: [{ code: 'human_check', message: REASON_LABELS.human_check }] };
      }
    }

    // 4. Compare-and-set: the kill switch or a concurrent run wins → nothing is sent.
    const cas = await db.application.updateMany({ where: { id: appId, status: 'approved' }, data: { status: 'submitting', submittedVia: opts.assisted ? 'assisted' : 'auto' } });
    if (cas.count !== 1) {
      await saveArtifacts();
      await event('warn', 'not approved anymore (kill switch or concurrent run): nothing sent');
      return { status: 'noop', reasons: [] };
    }

    if (opts.assisted) {
      // The user completes the check and clicks submit; the system only watches for the confirmation.
      await page.evaluate(`(() => { const b = document.createElement('div'); b.id = '__autoapply_banner'; b.textContent = 'AutoApply: conclua a verificação e clique em enviar. O AutoApply não envia nem resolve captcha.'; b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1d4ed8;color:#fff;font:600 15px system-ui;padding:12px 16px;text-align:center'; document.body.appendChild(b); })()`).catch(() => undefined);
      let closed = false;
      page.on('close', () => (closed = true));
      if (deps.userAction) void deps.userAction(page);
      const deadline = Date.now() + (deps.assistedWaitMs ?? 15 * 60_000);
      while (Date.now() < deadline && !closed) {
        if (isSubmittedConfirmation(await pageText(page), page.url())) return await done('assisted');
        await page.waitForTimeout(1000).catch(() => undefined);
      }
      return await stop('human_check', REASON_LABELS.human_check, 'submitting');
    }

    const control = await findSubmitControl(frame, adapter.scope);
    if (!control) return await stop('form_changed', 'botão de envio não encontrado', 'submitting');
    clicked = true;
    await control.click({ timeout: 10_000 });
    await event('info', 'clicked submit');

    // 5. Outcome: confirmation, a human check that blocked the send, or unknown (never retried).
    const deadline = Date.now() + (deps.confirmWaitMs ?? 30_000);
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000).catch(() => undefined);
      if (isSubmittedConfirmation(await pageText(page), page.url())) return await done('auto');
      const b = detectBlockers(await snapshotForBlockers(page, 1));
      if (b.blocker === 'captcha') {
        // The challenge stopped the send: hand over to the user (assisted) without sending anything else.
        await db.application.updateMany({ where: { id: appId, status: 'submitting' }, data: { status: 'approved', submittedVia: null } });
        await shot(page, 'screenshot_last', 'captcha');
        await saveArtifacts();
        await event('warn', 'captcha after click: assisted required');
        return { status: 'assisted_required', reasons: [{ code: 'human_check', message: REASON_LABELS.human_check }] };
      }
    }
    await shot(page, 'screenshot_last', 'uncertain');
    return await uncertain('confirmação não detectada');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await shot(page, 'screenshot_last', 'error').catch(() => undefined);
    if (err instanceof AdapterStop) {
      if (err.code === 'session_expired' && (platform === 'gupy' || platform === 'linkedin')) await markSessionExpired(deps, platform);
      if (err.code === 'unusual_activity') await recordPlatformError(db, platform, 'unusual_activity');
      return stop(err.code === 'job_closed' ? 'job_closed' : err.code);
    }
    await recordPlatformError(db, platform, 'errors').catch(() => undefined);
    // After the click nothing is known for sure: uncertain, never resubmitted (FR-009).
    if (clicked) return uncertain(message);
    return stop('form_changed', `erro antes do envio: ${message.slice(0, 200)}`);
  } finally {
    await context.close().catch(() => undefined);
    if (opts.assisted && deps.headedBrowser) await browser.close().catch(() => undefined);
  }

  async function done(via: 'auto' | 'assisted'): Promise<SubmitResult> {
    await shot(page, 'screenshot_confirmation', 'confirmation');
    await saveArtifacts();
    await db.application.updateMany({
      where: { id: appId, status: 'submitting' },
      data: { status: 'submitted', submittedAt: new Date(), submittedVia: via, sentValues: sent as never, needsReasons: [] as never, needsReason: null, submitError: null },
    });
    await recordPlatformOk(db, platform);
    await event('info', `submitted (${via})`);
    return { status: 'submitted', reasons: [] };
  }

  async function uncertain(why: string): Promise<SubmitResult> {
    await saveArtifacts();
    await db.application.updateMany({ where: { id: appId, status: 'submitting' }, data: { status: 'submit_uncertain', sentValues: sent as never, submitError: why } });
    await event('error', `uncertain: ${why}`);
    return { status: 'submit_uncertain', reasons: [] };
  }
}

/** The adapter's form frame after a step change (LinkedIn modal keeps the main frame). */
async function openFormFrame(adapter: Adapter, page: Page): Promise<Frame | null> {
  if (adapter.scope) return page.mainFrame();
  return null;
}
