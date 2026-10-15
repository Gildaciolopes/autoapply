import type { RenderFact, RenderProfile } from '../../src/model.js';

/** Synthetic persona — no real PII. */
export const anaProfile: RenderProfile = {
  fullName: 'Ana Beatriz Souza',
  headline: 'Engenheira de Software Full-Stack',
  email: 'ana.souza@example.com',
  phone: '+55 11 90000-0000',
  city: 'São Paulo, SP',
  linkedinUrl: 'https://www.linkedin.com/in/ana-souza-example',
  githubUser: 'ana-example',
  summary: 'Engenheira full-stack com foco em TypeScript, Node.js e produtos B2B.',
};

const m = (year: number, month: number) => ({ year, month, precision: 'month' as const });

export const anaFacts: RenderFact[] = [
  {
    id: 'exp-xeno',
    kind: 'experience',
    value: {
      company: 'Xeno Tecnologia',
      title: 'Engenheira de Software Sênior',
      location: 'São Paulo',
      start: m(2021, 3),
      end: 'present',
      highlights: [
        'Migrei a API de pagamentos de Express para NestJS, reduzindo a latência p95 em 40%.',
        'Implantei filas com BullMQ e Redis para processar 2 milhões de eventos por dia.',
        'Liderei a adoção de testes com Vitest, elevando a cobertura de 35% para 80%.',
      ],
    },
  },
  {
    id: 'exp-loja',
    kind: 'experience',
    value: {
      company: 'Loja Fácil',
      title: 'Desenvolvedora Pleno',
      start: m(2018, 6),
      end: m(2021, 2),
      highlights: ['Desenvolvi o checkout em React e Next.js usado por 300 lojas.', 'Modelei o banco PostgreSQL de pedidos e estoque.'],
    },
  },
  { id: 'edu-usp', kind: 'education', value: { institution: 'Universidade de São Paulo', degree: 'Bacharelado', area: 'Ciência da Computação', start: { year: 2014, precision: 'year' }, end: { year: 2018, precision: 'year' } } },
  { id: 'sk-ts', kind: 'skill', value: { name: 'TypeScript', category: 'Linguagens' } },
  { id: 'sk-py', kind: 'skill', value: { name: 'Python', category: 'Linguagens' } },
  { id: 'sk-nest', kind: 'skill', value: { name: 'NestJS', category: 'Back-end' } },
  { id: 'sk-pg', kind: 'skill', value: { name: 'PostgreSQL', category: 'Back-end' } },
  { id: 'sk-react', kind: 'skill', value: { name: 'React', category: 'Front-end' } },
  { id: 'lang-pt', kind: 'language', value: { language: 'Português', fluency: 'nativo' } },
  { id: 'lang-en', kind: 'language', value: { language: 'Inglês', fluency: 'avançado' } },
  { id: 'cert-aws', kind: 'certification', value: { name: 'AWS Certified Developer – Associate', issuer: 'Amazon Web Services' } },
];

/** Same persona with many extra bullets: must overflow one page. */
export const longFacts: RenderFact[] = [
  ...anaFacts,
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `exp-extra-${i}`,
    kind: 'experience' as const,
    value: {
      company: `Empresa Exemplo ${i + 1}`,
      title: 'Desenvolvedora',
      start: m(2010 + i, 1),
      end: m(2010 + i, 12),
      highlights: Array.from({ length: 5 }, (_, j) => `Entrega relevante número ${j + 1} com uma descrição longa o suficiente para ocupar uma linha inteira do currículo.`),
    },
  })),
];
