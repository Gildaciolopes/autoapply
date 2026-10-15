import { Preferences } from '@autoapply/shared';
import type { ProfileFact } from '../src/profile.js';

/** Persona Ana (synthetic) — usable facts. */
export const anaFacts: ProfileFact[] = [
  { id: 'f-exp1', kind: 'experience', value: { company: 'Xeno Tecnologia', title: 'Engenheira de Software Sênior', start: { year: 2021, month: 3, precision: 'month' }, end: 'present', highlights: ['Migrei a API de pagamentos para NestJS e PostgreSQL', 'Filas com BullMQ e Redis'] } },
  { id: 'f-exp0', kind: 'experience', value: { company: 'Loja Fácil', title: 'Desenvolvedora Pleno', start: { year: 2018, month: 6, precision: 'month' }, end: { year: 2021, month: 2, precision: 'month' }, highlights: ['Checkout em React e Next.js'] } },
  { id: 'f-ts', kind: 'skill', value: { name: 'TypeScript', evidence: { repoCount: 12, lastActivity: '2026-10-01', repos: [], forkOnly: false, archivedOnly: false, via: ['language'] } } },
  { id: 'f-node', kind: 'skill', value: { name: 'Node.js' } },
  { id: 'f-react', kind: 'skill', value: { name: 'React', evidence: { repoCount: 3, lastActivity: '2025-01-01', repos: [], forkOnly: false, archivedOnly: false, via: ['manifest'] } } },
  { id: 'f-pg', kind: 'skill', value: { name: 'Postgres' } },
  { id: 'f-docker', kind: 'skill', value: { name: 'Docker' } },
];

export const prefs = (over: Partial<Preferences> = {}): Preferences =>
  Preferences.parse({
    roles: ['Desenvolvedor Full Stack', 'Engenheiro de Software'],
    seniority: ['senior', 'lead'],
    stack: ['TypeScript', 'Node.js', 'React'],
    locations: ['São Paulo/SP', 'remote'],
    workModes: ['remote', 'hybrid'],
    minSalary: 12000,
    blockedCompanies: ['Empresa Ruim'],
    excludeKeywords: ['php', 'wordpress'],
    ...over,
  });
