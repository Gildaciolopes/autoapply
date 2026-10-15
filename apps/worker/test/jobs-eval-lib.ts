import { applyHardFilters, buildJudgeMessages, cosine, groundMatches, profileText, similarityToScore, type ProfileFact } from '@autoapply/jobs';
import type { LlmProvider } from '@autoapply/llm';
import { JudgeResult, Preferences } from '@autoapply/shared';

/** Labelled eval (SC-005) — same stages as production scoring, without the DB. */
export interface EvalJob {
  id: string;
  title: string;
  company: string;
  description: string;
  relevant: boolean;
  workMode: 'remote' | null;
}

export const evalFacts: ProfileFact[] = [
  { id: 'f-exp1', kind: 'experience', value: { company: 'Xeno Tecnologia', title: 'Engenheira de Software Sênior', start: { year: 2021, month: 3, precision: 'month' }, end: 'present', highlights: ['Migrei a API de pagamentos para NestJS e PostgreSQL', 'Filas com BullMQ e Redis'] } },
  { id: 'f-exp0', kind: 'experience', value: { company: 'Loja Fácil', title: 'Desenvolvedora Pleno', start: { year: 2018, month: 6, precision: 'month' }, end: { year: 2021, month: 2, precision: 'month' }, highlights: ['Checkout em React e Next.js'] } },
  ...['TypeScript', 'JavaScript', 'Node.js', 'NestJS', 'React', 'Next.js', 'PostgreSQL', 'Redis', 'Docker', 'Python'].map((name, i) => ({ id: `f-s${i}`, kind: 'skill' as const, value: { name } })),
];

export const evalPrefs = Preferences.parse({
  roles: ['Desenvolvedor Full Stack', 'Engenheira de Software'],
  stack: ['TypeScript', 'React', 'Node.js'],
  workModes: ['remote', 'hybrid'],
  locations: ['São Paulo/SP', 'remote'],
  judgeTopN: 10,
});

const jobText = (j: EvalJob) => `${j.title}\n${j.company}\n${j.description}`;

export interface EvalRecording {
  profile: number[];
  jobs: Record<string, number[]>;
  judge: Record<string, JudgeResult>;
}

/** Runs the pipeline; with `llm` it calls the live models and returns a recording. */
export async function runEval(jobs: EvalJob[], src: { llm: LlmProvider; chatModel?: string } | { recording: EvalRecording }) {
  const live = 'llm' in src;
  const rec: EvalRecording = live ? { profile: [], jobs: {}, judge: {} } : src.recording;
  const passing = jobs.filter((j) => applyHardFilters({ company: j.company, title: j.title, description: j.description, remote: j.workMode === 'remote', workMode: j.workMode }, evalPrefs).passed);
  if (live) {
    rec.profile = (await src.llm.embed([profileText(evalFacts, evalPrefs)]))[0]!;
    const vs = await src.llm.embed(passing.map(jobText));
    passing.forEach((j, i) => (rec.jobs[j.id] = vs[i]!));
  }
  const sim = new Map(passing.map((j) => [j.id, cosine(rec.jobs[j.id]!, rec.profile)]));
  const top = [...passing].sort((a, b) => sim.get(b.id)! - sim.get(a.id)!).slice(0, evalPrefs.judgeTopN);
  const scores = new Map(passing.map((j) => [j.id, similarityToScore(sim.get(j.id)!)]));
  const grounded: Record<string, ReturnType<typeof groundMatches>> = {};
  for (const j of top) {
    if (live) {
      rec.judge[j.id] = await src.llm.generateObject({
        schema: JudgeResult,
        model: src.chatModel,
        temperature: 0,
        numCtx: 16384,
        messages: buildJudgeMessages({ title: j.title, company: j.company, workMode: j.workMode, description: j.description }, evalFacts, evalPrefs),
      });
    }
    const g = groundMatches(rec.judge[j.id]!, evalFacts);
    grounded[j.id] = g;
    scores.set(j.id, g.score);
  }
  const ranked = [...jobs].sort((a, b) => (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1));
  return { recording: rec, ranked, grounded, filteredOut: jobs.length - passing.length };
}
