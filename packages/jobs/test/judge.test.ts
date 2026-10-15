import { describe, expect, it } from 'vitest';
import { buildJudgeMessages, groundMatches } from '../src/judge.js';
import { anaFacts, prefs } from './fixtures.js';

describe('groundMatches (FR-014)', () => {
  it('keeps evidenced skills, demotes the rest', () => {
    const g = groundMatches(
      {
        score: 82,
        matched: [
          { skill: 'PostgreSQL', factIds: ['f-pg'] }, // alias of "Postgres" skill fact
          { skill: 'BullMQ', factIds: ['f-exp1'] }, // named in experience highlights
          { skill: 'Kubernetes', factIds: ['f-docker'] }, // fact does not prove it
          { skill: 'Go', factIds: ['f-nope'] }, // unknown fact id
          { skill: 'TypeScript', factIds: [] },
        ],
        missing: ['AWS'],
        reasons: 'ok',
      },
      anaFacts,
    );
    expect(g.matched).toEqual([
      { skill: 'PostgreSQL', factIds: ['f-pg'] },
      { skill: 'BullMQ', factIds: ['f-exp1'] },
    ]);
    expect(g.demoted).toEqual(['Kubernetes', 'Go', 'TypeScript']);
    expect(g.missing).toEqual(['AWS', 'Kubernetes', 'Go', 'TypeScript']);
  });

  it('prompt lists facts with ids and the job', () => {
    const [sys, user] = buildJudgeMessages({ title: 'Dev Node', company: 'Acme', description: 'NestJS' }, anaFacts, prefs());
    expect(sys!.content).toContain('Use ONLY the candidate facts');
    expect(user!.content).toContain('[f-ts] skill: TypeScript');
    expect(user!.content).toContain('Title: Dev Node');
  });
});
