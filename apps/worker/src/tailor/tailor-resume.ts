import type { Prisma } from '@autoapply/db';
import { factsToRenderModel, renderResumePdf } from '@autoapply/resume';
import { buildSummaryMessages, factsHash, overflowCandidates, rankForJob } from '@autoapply/tailor';
import type { KbDeps } from '../kb/deps.js';
import { factsForPrompt, loadTailorContext, type TailorContext } from './context.js';
import { generateSentences } from './generate.js';

const MAX_OVERFLOW_STEPS = 8;
const RENDER_KINDS = new Set(['experience', 'education', 'skill', 'language', 'certification', 'project']);

/** Hides least relevant items until the tailored resume fits one page (FR-004). */
export async function fitOnePage(ctx: TailorContext, plan: ReturnType<typeof rankForJob>, summary: string) {
  if (!ctx.profile) return { hidden: [] as string[], fits: false };
  const facts = ctx.facts.filter((f) => RENDER_KINDS.has(f.kind));
  const candidates = overflowCandidates(plan, facts);
  const hidden: string[] = [...plan.hiddenItemIds];
  for (let step = 0; step <= MAX_OVERFLOW_STEPS; step++) {
    const model = factsToRenderModel(ctx.profile, facts, { lang: ctx.lang, plan: { ...plan, summary, hiddenItemIds: hidden } });
    const r = await renderResumePdf(model);
    if (!r.overflow) return { hidden, fits: true };
    const next = candidates.shift();
    if (!next) break;
    hidden.push(next);
  }
  return { hidden, fits: false };
}

export async function tailorResume(deps: KbDeps, docId: string) {
  const { db } = deps;
  const doc = await db.tailoredDocument.findUniqueOrThrow({ where: { id: docId } });
  const ctx = await loadTailorContext(db, doc.jobId);
  if (!ctx.facts.length) throw new Error('no_facts');
  const plan = rankForJob(ctx.job, ctx.facts);
  const gen = await generateSentences(deps, buildSummaryMessages(ctx.job, factsForPrompt(ctx), ctx.lang), { usableFacts: ctx.facts, knownOrgs: ctx.knownOrgs, targetCompany: ctx.job.company }, { maxSentences: 4 });
  const summary = gen.sentences.map((s) => s.text).join(' ');
  const fit = await fitOnePage(ctx, plan, summary);
  plan.hiddenItemIds = fit.hidden;
  const included = ctx.facts.filter((f) => RENDER_KINDS.has(f.kind) && !fit.hidden.includes(f.id));
  const cited = new Set(gen.sentences.flatMap((s) => s.factIds));
  const deps2 = ctx.facts.filter((f) => included.includes(f) || cited.has(f.id));
  const findings = fit.fits ? gen.report.findings : [...gen.report.findings, { sentenceIndex: -1, type: 'too_long' as const, token: 'mais de 1 página' }];
  await db.tailoredDocument.update({
    where: { id: docId },
    data: {
      status: findings.length ? 'needs_review' : 'draft',
      lang: ctx.lang,
      plan: plan as unknown as Prisma.InputJsonValue,
      sentences: gen.sentences as unknown as Prisma.InputJsonValue,
      validation: { ...gen.report, ok: findings.length === 0, findings } as unknown as Prisma.InputJsonValue,
      factIds: deps2.map((f) => f.id),
      factsHash: factsHash(deps2),
      model: deps.models.chat,
      error: null,
    },
  });
  return { status: findings.length ? 'needs_review' : 'draft', hidden: fit.hidden.length };
}

