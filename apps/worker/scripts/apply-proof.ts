/**
 * F4 proof (SC-001/SC-002): dry-run simulations on real public forms with the user's real facts.
 *   pnpm exec tsx --env-file=../../.env scripts/apply-proof.ts urls.txt
 * One URL per line (job page or form). Runs sequentially, 20 s apart, in the dry-run context: nothing is
 * submitted, only GETs (and Ashby read-only GraphQL queries) leave the machine. Screenshots go to MinIO;
 * the report is written to data/apply-proof-<date>.json (gitignored, contains personal data).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { classifyField, detectAts } from '@autoapply/apply';
import { createPrismaClient } from '@autoapply/db';
import { localDate } from '@autoapply/kb';
import { ollamaFromEnv } from '@autoapply/llm';
import { closeRenderer } from '@autoapply/resume';
import { ApplyReport } from '@autoapply/shared';
import { S3BlobStore } from '../src/kb/deps.js';
import { runApply } from '../src/apply/run.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: apply-proof.ts <urls.txt>');
  process.exit(1);
}
const urls = readFileSync(file, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const db = createPrismaClient();
const browser = await chromium.launch({ headless: true });
const deps = {
  db,
  storage: new S3BlobStore(),
  llm: ollamaFromEnv(),
  models: { chat: process.env.OLLAMA_CHAT_MODEL ?? 'qwen3:8b', vision: process.env.OLLAMA_VISION_MODEL ?? 'qwen2.5vl:7b' },
  browser: async () => browser,
};

const STANDARD = new Set(['first_name', 'last_name', 'full_name', 'email', 'phone', 'linkedin', 'github', 'resume']);
const rows: Record<string, unknown>[] = [];
try {
  for (const [i, url] of urls.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 20_000));
    const ats = detectAts(url).ats;
    // Proof jobs are hidden from the feed; their sources stay disabled (never used for discovery).
    const src = await db.source.upsert({ where: { type: ats }, create: { type: ats, enabled: false }, update: {} });
    const dedupeHash = `proof-${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
    const job = await db.job.upsert({
      where: { dedupeHash },
      create: { sourceId: src.id, url, applyUrl: url, title: `Prova F4 ${i + 1}`, dedupeHash, hidden: true },
      update: {},
    });
    const prev = await db.application.findUnique({ where: { jobId: job.id } });
    const app = await db.application.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, mode: 'dry_run', status: 'queued', attempts: 1 },
      update: { mode: 'dry_run', status: 'queued', attempts: { increment: 1 } },
    });
    const t0 = Date.now();
    const res = await runApply(deps, { applicationId: app.id, attempt: app.attempts }, { final: true }).catch((e: Error) => ({ status: 'failed' as const, reasons: [], error: e.message }));
    const row = await db.application.findUniqueOrThrow({ where: { id: app.id }, include: { answers: true, artifacts: { where: { attempt: app.attempts } } } });
    const report = ApplyReport.parse(row.report ?? {});
    const std = row.answers.filter((a) => {
      const c = classifyField({ label: a.question, type: a.fieldType as never, key: a.fieldKey });
      return c.kind === 'standard' && STANDARD.has(c.std);
    });
    const resume = row.answers.find((a) => a.source === 'anexo' && a.answer?.startsWith('currículo'));
    const out = {
      url,
      ats: row.ats,
      status: res.status,
      seconds: Math.round((Date.now() - t0) / 1000),
      standardFilled: `${std.filter((a) => a.filled).length}/${std.length}`,
      resumeAttached: resume ? resume.filled : null,
      screenshots: row.artifacts.map((a) => a.label),
      submitAttempts: report.submitAttempts,
      blockedNonGet: report.blockedRequests.length,
      captchaOnSubmit: report.captchaOnSubmit,
      reasons: res.reasons.map((r) => r.message),
      error: row.error,
      previousAttempts: prev?.attempts ?? 0,
    };
    rows.push(out);
    console.log(`${i + 1}/${urls.length} ${out.ats} ${out.status} std ${out.standardFilled} cv ${out.resumeAttached} shots ${out.screenshots.join(',')} submit ${out.submitAttempts} · ${url}`);
  }
} finally {
  await browser.close();
  await closeRenderer();
  await db.$disconnect();
}
mkdirSync(new URL('../../../data/', import.meta.url), { recursive: true });
const outFile = new URL(`../../../data/apply-proof-${localDate()}.json`, import.meta.url);
writeFileSync(outFile, JSON.stringify(rows, null, 1));
const submitted = rows.reduce((n, r) => n + (r.submitAttempts as number), 0);
console.log(`\n${rows.length} forms · submit attempts ${submitted} · report ${outFile.pathname}`);
