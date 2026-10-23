import type { Prisma } from '@autoapply/db';
import { buildLetterMessages, factsHash } from '@autoapply/tailor';
import type { KbDeps } from '../kb/deps.js';
import { factsForPrompt, loadTailorContext } from './context.js';
import { generateSentences } from './generate.js';

export const LETTER_MAX_WORDS = 250;

/** Cover letter (US4): cited sentences with roles; target company only in greeting/closing (FR-012/013). */
export async function tailorLetter(deps: KbDeps, docId: string) {
  const { db } = deps;
  const doc = await db.tailoredDocument.findUniqueOrThrow({ where: { id: docId } });
  const ctx = await loadTailorContext(db, doc.jobId);
  if (!ctx.facts.length) throw new Error('no_facts');
  const gen = await generateSentences(
    deps,
    buildLetterMessages(ctx.job, factsForPrompt(ctx), ctx.profile?.fullName ?? '', ctx.lang),
    { usableFacts: ctx.facts, knownOrgs: ctx.knownOrgs, targetCompany: ctx.job.company, candidateName: ctx.profile?.fullName },
    { maxSentences: 14, maxWords: LETTER_MAX_WORDS, letter: true },
  );
  const cited = new Set(gen.sentences.flatMap((s) => s.factIds));
  const used = ctx.facts.filter((f) => cited.has(f.id));
  await db.tailoredDocument.update({
    where: { id: docId },
    data: {
      status: gen.status,
      lang: ctx.lang,
      sentences: gen.sentences as unknown as Prisma.InputJsonValue,
      validation: gen.report as unknown as Prisma.InputJsonValue,
      factIds: used.map((f) => f.id),
      factsHash: factsHash(used),
      model: deps.models.chat,
      error: null,
    },
  });
  return { status: gen.status };
}
