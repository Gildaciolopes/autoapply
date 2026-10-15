import type { Prisma } from '@autoapply/db';
import { extractPdfText, isImageOnly, renderPagesPng } from '@autoapply/resume';
import { extractDraft, transcribePages } from './draft-llm.js';
import { runEvent, type KbDeps } from './deps.js';

/**
 * parse_resume: PDF from MinIO → text (or vision OCR) → local LLM → ResumeDraft with
 * not_in_source flags → status `review`. Never writes facts (only the user's confirm does).
 */
export async function parseResume(deps: KbDeps, resumeId: string, mode: 'text' | 'vision'): Promise<{ status: string }> {
  const { db } = deps;
  const row = await db.resumeBase.findUniqueOrThrow({ where: { id: resumeId } });
  await db.resumeBase.update({ where: { id: resumeId }, data: { status: 'parsing', error: null } });
  await runEvent(db, 'info', `parse_resume ${resumeId} (${mode})`);

  try {
    const pdf = await deps.storage.get(row.minioKey);
    let sourceText: string;
    if (mode === 'text') {
      const t = await extractPdfText(pdf);
      if (isImageOnly(t)) {
        await db.resumeBase.update({ where: { id: resumeId }, data: { status: 'image_only', rawText: t.text } });
        await runEvent(db, 'warn', `resume ${resumeId} has no text layer (${t.chars} chars)`);
        return { status: 'image_only' };
      }
      sourceText = t.text;
    } else {
      sourceText = await transcribePages(deps.llm, await renderPagesPng(pdf), deps.models.vision);
    }

    const draft = await extractDraft(deps.llm, sourceText, { model: deps.models.chat });
    await db.resumeBase.update({
      where: { id: resumeId },
      data: { status: 'review', rawText: sourceText, extraction: mode, parsed: draft as Prisma.InputJsonValue },
    });
    await runEvent(db, 'info', `resume ${resumeId} ready for review`, {
      work: draft.work.length,
      skills: draft.skills.length,
    });
    return { status: 'review' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.resumeBase.update({ where: { id: resumeId }, data: { status: 'failed', error: message } });
    await runEvent(db, 'error', `parse_resume ${resumeId} failed: ${message}`);
    throw err;
  }
}
