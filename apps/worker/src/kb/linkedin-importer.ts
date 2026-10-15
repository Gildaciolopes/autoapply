import type { Prisma } from '@autoapply/db';
import { draftToCandidates } from '@autoapply/kb';
import type { ResumeDraft } from '@autoapply/shared';
import { extractDraft } from './draft-llm.js';
import { applyImport, countsOf, recordOutcome } from './import-common.js';
import { runEvent, type KbDeps } from './deps.js';

export interface McpCaller {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}

const SESSION_ERROR = /login|log in|session|sess[aã]o|auth|401|403|cookie|expired|sign in/i;

/** MCP tool output (structuredContent or text content blocks) → plain text for parsing + provenance. */
export function mcpToText(out: unknown): string {
  if (typeof out === 'string') return out;
  if (Array.isArray(out)) {
    return out
      .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : mcpToText(b)))
      .join('\n');
  }
  if (out && typeof out === 'object') {
    return Object.entries(out as Record<string, unknown>)
      .map(([k, v]) => (typeof v === 'string' ? `${k}: ${v}` : mcpToText(v)))
      .join('\n');
  }
  return out === null || out === undefined ? '' : String(out);
}

const withoutFlagged = (d: ResumeDraft): ResumeDraft => {
  const keep = <T extends { flags: string[] }>(xs: T[]) => xs.filter((x) => !x.flags.includes('not_in_source'));
  return {
    ...d,
    work: keep(d.work),
    education: keep(d.education),
    skills: keep(d.skills),
    languages: keep(d.languages),
    certificates: keep(d.certificates),
    projects: keep(d.projects),
  };
};

/**
 * import_linkedin (US5): opt-in only (FR-016), own profile via read-only MCP tool get_my_profile,
 * mapped with the same LLM path as the resume, provenance-checked against the raw tool output.
 * Items not found in the output are dropped (and logged), never imported.
 */
export async function importLinkedin(deps: KbDeps, syncRunId: string, mcp: McpCaller, opts: { actor?: 'import' | 'sync' } = {}) {
  const { db } = deps;
  const src = await db.profileSource.findUnique({ where: { origin: 'linkedin' } });
  if (!src?.enabled) {
    await recordOutcome(db, syncRunId, 'linkedin', { status: 'skipped', error: 'source_disabled' });
    return { status: 'skipped' };
  }

  let raw: unknown;
  try {
    raw = await mcp.call('get_my_profile', {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = SESSION_ERROR.test(message) ? 'session_expired' : 'mcp_unavailable';
    await recordOutcome(db, syncRunId, 'linkedin', { status: 'failed', error: code });
    await runEvent(db, 'warn', `linkedin import failed (${code}): ${message}`, code === 'session_expired' ? { hint: 'make linkedin-login' } : undefined);
    return { status: 'failed', error: code };
  }

  const text = mcpToText(raw);
  const draft = await extractDraft(deps.llm, text, { model: deps.models.chat });
  const dropped = [draft.work, draft.education, draft.skills, draft.languages, draft.certificates, draft.projects]
    .flat()
    .filter((i) => i.flags.includes('not_in_source'))
    .map((i) => i.id);
  if (dropped.length) await runEvent(db, 'warn', `linkedin: ${dropped.length} item(s) not found in profile output were dropped`, { dropped });

  const candidates = draftToCandidates(withoutFlagged(draft), '', 'linkedin');
  const counts = await applyImport(db, 'linkedin', candidates, { complete: true, actor: opts.actor ?? 'import' });
  await recordOutcome(db, syncRunId, 'linkedin', { status: 'success', counts: countsOf(counts) }, counts, {
    snapshot: { fetchedAt: new Date().toISOString(), raw } as Prisma.InputJsonValue,
  });
  await runEvent(db, 'info', `linkedin import: ${counts.added.length} new facts, ${counts.conflicted.length} conflicts`);
  return { status: 'success', ...countsOf(counts) };
}
