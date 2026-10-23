import { describe, expect, it } from 'vitest';
import type { ProfileFact } from '@autoapply/jobs';
import { generateSentences } from '../src/tailor/generate.js';
import { tailorDeps } from './tailor-helpers.js';
import persona from './fixtures/eval-tailor/persona.json' with { type: 'json' };

const ctx = { usableFacts: persona.facts as ProfileFact[], knownOrgs: persona.knownOrgs, targetCompany: 'Acme' };
const NOW = new Date('2026-10-15T12:00:00Z');
const msgs = [{ role: 'user' as const, content: 'x' }];

describe('generateSentences (US2)', () => {
  it('fabrication → retry with findings → clean second answer = draft', async () => {
    const seen: string[] = [];
    const deps = tailorDeps((m) => {
      seen.push(m.at(-1)!.content);
      return seen.length === 1
        ? { sentences: [{ text: 'Engenheira com 5 anos de Go.', factIds: ['f-exp1'] }] }
        : { sentences: [{ text: 'Engenheira de Software Sênior com {{anos:NestJS}} anos de NestJS.', factIds: ['f-exp1'] }] };
    });
    const r = await generateSentences(deps, msgs, ctx, { maxSentences: 4, now: NOW });
    expect(seen[1]).toContain('tecnologia sem evidência → "Go"');
    expect(seen[1]).toContain('número sem evidência → "5"');
    expect(r).toMatchObject({ status: 'draft', report: { ok: true, attempts: 2 } });
    expect(r.sentences[0]).toMatchObject({ text: 'Engenheira de Software Sênior com 5 anos de NestJS.', computed: [{ value: '5', source: ['f-exp1'] }] });
  });

  it('two bad answers → needs_review with findings', async () => {
    const bad = { sentences: [{ text: 'Trabalhei no Google com Kubernetes.', factIds: ['f-exp1'] }] };
    const r = await generateSentences(tailorDeps([bad, bad]), msgs, ctx, { maxSentences: 4, now: NOW });
    expect(r.status).toBe('needs_review');
    expect(r.report.findings.map((f) => f.type).sort()).toEqual(['org_without_evidence', 'tech_without_evidence']);
  });

  it('letter over the word limit is retried and flagged', async () => {
    const long = { sentences: [{ text: Array(260).fill('NestJS').join(' '), factIds: ['f-nest'] }] };
    const r = await generateSentences(tailorDeps([long, long]), msgs, ctx, { maxSentences: 14, maxWords: 250, now: NOW });
    expect(r.report.findings.map((f) => f.type)).toContain('too_long');
  });
});
