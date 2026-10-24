import type { Browser, Frame, Page } from 'playwright';
import {
  ATTACH_LETTER,
  ATTACH_RESUME,
  REASON_LABELS,
  applicationFactsHash,
  atsOfFrame,
  classifyField,
  detectAts,
  formLanguage,
  detectBlockers,
  isClosedPosting,
  planAnswers,
  type AnswerContext,
  type DetectedAts,
} from '@autoapply/apply';
import { loadPreferences, localMidnight, type Prisma } from '@autoapply/db';
import { LlmFieldAnswers, PersonalFacts, type ApplyPayload, type ApplyReport, type NeedsReason, type PersonalField, type PlannedAnswer } from '@autoapply/shared';
import type { KbDeps } from '../kb/deps.js';
import { adapterFor, mergeHints, type Adapter } from './adapters/index.js';
import { acceptsPdf, ensureTailored, letterFile, loadTailorBasics, resumeFile } from './attachments.js';
import { openDryRunContext, screenshot, submitLog, type DryRunContext, type FixtureServer } from './browser.js';
import { extractFields, snapshotForBlockers, type ExtractedField } from './extract.js';
import { attachFile, fillField, nextStep, readComboOptions, type AttachmentFile } from './fill.js';
import { memoryCandidates } from './memory.js';

export const MAX_STEPS = 6;

export interface ApplyDeps extends KbDeps {
  browser: () => Promise<Browser>;
  /** Tests: offline fixtures served inside the dry-run guard. */
  serve?: FixtureServer;
}

export interface RunApplyResult {
  status: 'ready' | 'needs_input' | 'failed' | 'skipped';
  reasons: NeedsReason[];
}

class Cancelled extends Error {}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Public GET JSON with a 24 h in-memory cache (adapter hints, posting checks). */
const jsonCache = new Map<string, { at: number; data: unknown }>();
function makeGetJson(deps: ApplyDeps) {
  return async (url: string) => {
    const hit = jsonCache.get(url);
    if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.data;
    try {
      const res = await (deps.fetch ?? fetch)(url, { method: 'GET', headers: { accept: 'application/json' } });
      const data = res.ok ? await res.json() : res.status === 404 ? {} : null;
      if (data !== null) jsonCache.set(url, { at: Date.now(), data });
      return data;
    } catch {
      return null;
    }
  };
}

function answerContext(basics: Awaited<ReturnType<typeof loadTailorBasics>>, now: Date): AnswerContext {
  const raw: Record<string, unknown> = {};
  const personalIds: Partial<Record<PersonalField, string>> = {};
  for (const f of basics.facts) {
    if (f.kind !== 'personal') continue;
    const v = f.value as { field?: PersonalField; value?: unknown };
    if (!v.field) continue;
    raw[v.field] = v.value;
    if (v.value !== null && v.value !== 'not_provided' && !(Array.isArray(v.value) && !v.value.length)) personalIds[v.field] = f.id;
  }
  return {
    profile: basics.profile,
    facts: basics.facts,
    personal: PersonalFacts.parse(raw),
    personalIds,
    knownOrgs: basics.knownOrgs,
    job: basics.job,
    lang: basics.lang,
    now,
  };
}

/**
 * One dry-run simulation (research R1–R7, contracts/queues.md). Never submits: the page lives in a
 * dry-run context and the result is checked for submit attempts before it is accepted.
 */
export async function runApply(deps: ApplyDeps, payload: ApplyPayload, opts: { final?: boolean } = {}): Promise<RunApplyResult> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const appId = payload.applicationId;
  const app = await db.application.findUniqueOrThrow({ where: { id: appId }, include: { job: true } });
  if (app.status === 'skipped') return { status: 'skipped', reasons: [] };

  const t0 = Date.now();
  const durations: Record<string, number> = {};
  const mark = (k: string, since: number) => (durations[k] = Date.now() - since);
  const event = (level: 'info' | 'warn' | 'error', message: string, data?: unknown) =>
    db.runEvent.create({ data: { queue: 'apply', applicationId: appId, level, message, data: data === undefined ? undefined : json(data) } });
  const checkCancelled = async () => {
    const cur = await db.application.findUnique({ where: { id: appId }, select: { status: true } });
    if (!cur || cur.status === 'skipped') throw new Cancelled();
  };
  const artifacts: { type: string; label: string; key: string }[] = [];
  const shot = async (page: Page, type: string, label: string) => {
    const key = `applications/${appId}/${payload.attempt}/${label}.png`;
    await deps.storage.put(key, await screenshot(page), 'image/png');
    artifacts.push({ type, label, key });
    await event('info', `screenshot ${label}`);
  };

  await db.application.update({ where: { id: appId }, data: { status: 'tailoring', lastRunAt: now, error: null } });
  const prefs = await loadPreferences(db);
  const tailoredDocs: { id: string; updatedAt: Date }[] = [];
  let ctx: DryRunContext | null = null;
  let report: ApplyReport = { steps: 0, blockedRequests: [], submitAttempts: 0, scriptSubmits: 0, captchaOnSubmit: false, unverifiedFactIds: [], durations };

  const finish = async (status: RunApplyResult['status'], reasons: NeedsReason[], answers: { field: ExtractedField; a: PlannedAnswer; filled: boolean }[], extra: { ats?: string; formUrl?: string; error?: string } = {}) => {
    mark('total', t0);
    if (ctx) {
      const log = await submitLog(ctx.page).catch(() => []);
      // A submit of a form holding application fields counts as an attempt; widget/tracker forms don't.
      const isApplication = (x: { fields: number; hasEmail: boolean }) => x.hasEmail || x.fields >= 3;
      report = {
        ...report,
        blockedRequests: ctx.blockedRequests,
        submitAttempts: log.filter(isApplication).length,
        scriptSubmits: log.filter((x) => !isApplication(x)).length,
      };
    }
    if (report.submitAttempts > 0) {
      status = 'failed';
      extra.error = 'submit_attempted';
    }
    const basics = await loadTailorBasics(db, app.jobId);
    const used = new Set(answers.flatMap((x) => (x.a.value !== null ? x.a.evidence : [])));
    const hash = applicationFactsHash(basics.facts.filter((f) => used.has(f.id)), tailoredDocs);
    await db.$transaction([
      db.formAnswer.deleteMany({ where: { applicationId: appId } }),
      db.formAnswer.createMany({
        data: answers.map(({ field, a, filled }) => ({
          applicationId: appId,
          fieldKey: field.key,
          fieldType: field.type,
          required: field.required,
          options: field.options,
          step: field.step,
          frameUrl: field.frameUrl ?? null,
          question: field.label,
          answer: a.value === null ? null : Array.isArray(a.value) ? a.value.join('; ') : a.value === ATTACH_RESUME ? 'currículo adaptado (PDF)' : a.value === ATTACH_LETTER ? 'carta de apresentação' : a.value,
          confidence: a.confidence,
          source: a.source,
          evidence: a.evidence,
          blocking: a.blocking,
          reason: a.reason ?? null,
          findings: json(a.findings),
          filled,
        })),
      }),
      db.artifact.createMany({ data: artifacts.map((x) => ({ applicationId: appId, type: x.type, label: x.label, attempt: payload.attempt, minioKey: x.key })) }),
      db.application.update({
        where: { id: appId },
        data: {
          status,
          needsReasons: json(reasons),
          needsReason: reasons[0]?.message ?? null,
          report: json(report),
          factsHash: hash,
          tailoredDocIds: tailoredDocs.map((d) => d.id),
          ats: extra.ats ?? undefined,
          formUrl: extra.formUrl ?? undefined,
          error: extra.error ?? null,
          submittedAt: null,
        },
      }),
    ]);
    await event(status === 'failed' ? 'error' : 'info', `finish ${status}`, { reasons: reasons.map((r) => r.code), durations });
    return { status, reasons };
  };

  try {
    // 1. Tailored resume (inline F3 when missing).
    let since = Date.now();
    const resume = await ensureTailored(deps, app.jobId, 'resume');
    mark('tailoring', since);
    if (resume.doc) tailoredDocs.push({ id: resume.doc.id, updatedAt: resume.doc.updatedAt });
    if (!resume.ok) return finish('needs_input', [{ code: resume.reason, message: REASON_LABELS[resume.reason] }], []);
    await checkCancelled();
    await db.application.update({ where: { id: appId }, data: { status: 'applying' } });

    const basics = await loadTailorBasics(db, app.jobId);
    const actx = answerContext(basics, now);

    // 2. Open + detect.
    since = Date.now();
    ctx = await openDryRunContext(await deps.browser(), { serve: deps.serve });
    const { page } = ctx;
    const startUrl = app.job.applyUrl ?? app.job.url;
    let detected: DetectedAts = detectAts(startUrl);
    const getJson = makeGetJson(deps);
    let status: number | null = null;
    if (detected.ats === 'generic') {
      const res = await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      status = res?.status() ?? null;
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      const html = await page.content();
      const byHtml = detectAts(page.url(), html);
      const frameAts = page.frames().map((f) => atsOfFrame(f.url())).find(Boolean);
      if (byHtml.ats !== 'generic') detected = byHtml;
      else if (frameAts) detected = { ...detectAts(page.frames().find((f) => atsOfFrame(f.url()))!.url()), formUrl: page.url() };
    }
    const adapter: Adapter = adapterFor(detected.ats);
    await event('info', `detect ${detected.ats}`, detected);
    const actx2 = { page, detected, getJson };
    if ((await adapter.postingOpen(actx2)) === false) {
      return finish('failed', [{ code: 'job_closed', message: REASON_LABELS.job_closed }], [], { ats: detected.ats, formUrl: detected.formUrl, error: 'job_closed' });
    }
    let frame: Frame = await adapter.locate(actx2);
    mark('open', since);
    const pageText = await frame.evaluate('document.body ? document.body.innerText : ""').catch(() => '');
    const hints = await adapter.hints(actx2);
    await checkCancelled();

    // 3. Steps: extract → blockers → answer → fill → screenshot → next.
    const all: { field: ExtractedField; a: PlannedAnswer; filled: boolean }[] = [];
    const reasons: NeedsReason[] = [];
    let letter: { file: AttachmentFile; text: string } | null | undefined;
    let resumePdf: AttachmentFile | null | undefined;
    let llmMs = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      since = Date.now();
      const fields = mergeHints(await extractFields(frame, step), hints);
      for (const f of fields) if (f.combobox && !f.options.length) f.options = await readComboOptions(frame, f);
      const stepCtx: AnswerContext = { ...actx, lang: formLanguage(fields.map((f) => f.label), actx.lang) };
      mark(`extract_${step}`, since);
      await event('info', `extract step ${step}: ${fields.length} fields`);
      if (step === 0 && (fields.length === 0 ? isClosedPosting(String(pageText), status ?? undefined) : status === 404)) {
        return finish('failed', [{ code: 'job_closed', message: REASON_LABELS.job_closed }], [], { ats: detected.ats, formUrl: page.url(), error: 'job_closed' });
      }
      const blockers = detectBlockers(await snapshotForBlockers(page, fields.length));
      report.captchaOnSubmit ||= blockers.captchaOnSubmit;
      if (blockers.blocker) {
        await shot(page, 'screenshot_last', 'last');
        return finish('needs_input', [{ code: blockers.blocker, message: REASON_LABELS[blockers.blocker] }], all, { ats: detected.ats, formUrl: page.url() });
      }
      if (step === 0) await shot(page, 'screenshot_before', 'before');

      // Cover letter only when the form asks for one (generated inline if required).
      const letterField = fields.find((f) => {
        const c = classifyField(f);
        return c.kind === 'standard' && c.std === 'cover_letter';
      });
      if (letterField && letter === undefined) {
        const existing = await db.tailoredDocument.findUnique({ where: { jobId_kind: { jobId: app.jobId, kind: 'cover_letter' } } });
        if (letterField.required || existing) {
          const r = await ensureTailored(deps, app.jobId, 'cover_letter');
          if (r.doc) tailoredDocs.push({ id: r.doc.id, updatedAt: r.doc.updatedAt });
          letter = r.ok ? await letterFile(basics, r.doc) : null;
        } else letter = null;
        await checkCancelled();
      }

      since = Date.now();
      const memory = await memoryCandidates(deps, fields);
      const plan = await planAnswers(fields, stepCtx, {
        threshold: prefs.applyConfidence,
        memory,
        hasLetter: Boolean(letter),
        llm: async (messages) =>
          LlmFieldAnswers.parse(
            await deps.llm.generateObject({ schema: LlmFieldAnswers, model: deps.models.chat, temperature: 0.1, numCtx: 16384, messages }),
          ),
      });
      llmMs += Date.now() - since;
      await event('info', `answer step ${step}: ${plan.answers.filter((a) => a.value !== null).length}/${fields.length} answered, ${plan.reasons.length} blocking`, { llmCalls: plan.llmCalls });
      await checkCancelled();

      since = Date.now();
      for (const field of fields) {
        const a = plan.answers.find((x) => x.fieldKey === field.key)!;
        let filled = false;
        let ans = a;
        if (a.value === ATTACH_RESUME) {
          if (!acceptsPdf(field.accept)) {
            ans = { ...a, value: null, blocking: field.required, reason: 'attachment_rejected' };
            if (field.required) reasons.push({ code: 'attachment_rejected', fieldKey: field.key, message: `"${field.label}": ${REASON_LABELS.attachment_rejected}` });
          } else {
            resumePdf ??= await resumeFile(basics, resume.doc);
            filled = resumePdf ? await attachFile(frame, field, resumePdf) : false;
          }
        } else if (a.value === ATTACH_LETTER && letter) {
          filled = field.type === 'file' ? acceptsPdf(field.accept) && (await attachFile(frame, field, letter.file)) : await fillField(frame, field, letter.text);
        } else if (a.value !== null) {
          filled = await fillField(frame, field, a.value);
        }
        if (a.value !== null && !filled && field.required && ans.reason !== 'attachment_rejected') {
          reasons.push({ code: 'low_confidence', fieldKey: field.key, message: `"${field.label}": não foi possível preencher o campo` });
        }
        all.push({ field, a: ans, filled });
      }
      reasons.push(...plan.reasons);
      mark(`fill_${step}`, since);
      await event('info', `fill step ${step}`);
      report.steps = step + 1;

      if (!(await nextStep(frame))) break;
      await shot(page, 'screenshot_step', `step-${step + 1}`);
      frame = await adapter.locate(actx2);
      await checkCancelled();
    }
    durations.llm = llmMs;
    await shot(page, 'screenshot_after', 'after');
    return finish(reasons.length ? 'needs_input' : 'ready', reasons, all, { ats: detected.ats, formUrl: page.url() });
  } catch (err) {
    if (err instanceof Cancelled) {
      await event('warn', 'cancelled by kill switch');
      return { status: 'skipped', reasons: [] };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (ctx) await shot(ctx.page, 'screenshot_last', 'last').catch(() => undefined);
    if (!opts.final) {
      await db.application.update({ where: { id: appId }, data: { status: 'queued', error: message } });
      await event('warn', `attempt failed, will retry: ${message}`);
      throw err;
    }
    return finish('failed', [], [], { error: message });
  } finally {
    await ctx?.close().catch(() => undefined);
  }
}

/**
 * Daily cap per tracking system (FR-015, research R9). Returns the delay (ms) until 00:05 local time
 * tomorrow when the cap is reached (application set back to `queued` with reason `daily_cap`), else 0.
 */
export async function dailyCapDelay(deps: KbDeps, applicationId: string, now = new Date()): Promise<number> {
  const app = await deps.db.application.findUniqueOrThrow({ where: { id: applicationId }, include: { job: true } });
  const ats = app.ats ?? detectAts(app.job.applyUrl ?? app.job.url).ats;
  const prefs = await loadPreferences(deps.db);
  const since = localMidnight(now);
  const used = await deps.db.application.count({ where: { id: { not: applicationId }, ats, lastRunAt: { gte: since } } });
  if (used < prefs.applyDailyCap) {
    if (!app.ats) await deps.db.application.update({ where: { id: applicationId }, data: { ats } });
    return 0;
  }
  const next = new Date(since.getTime() + 24 * 3600_000 + 5 * 60_000);
  const reason: NeedsReason = { code: 'daily_cap', message: `${REASON_LABELS.daily_cap} (${ats}: ${prefs.applyDailyCap}/dia)` };
  await deps.db.application.update({ where: { id: applicationId }, data: { status: 'queued', ats, needsReasons: json([reason]), needsReason: reason.message } });
  return Math.max(60_000, next.getTime() - now.getTime());
}
