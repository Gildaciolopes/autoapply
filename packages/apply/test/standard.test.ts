import { describe, expect, it } from 'vitest';
import { answerStandard, formatDate, formatPhone } from '../src/standard.js';
import { anaContext, field } from './ctx.js';

describe('standard fields (FR-005)', () => {
  const ctx = anaContext();

  it('contact data from the Profile, cited as profile:me', () => {
    expect(answerStandard('first_name', field('First Name'), ctx)).toMatchObject({ value: 'Ana', source: 'fato', confidence: 1, evidence: ['profile:me'] });
    expect(answerStandard('last_name', field('Last Name'), ctx)!.value).toBe('Beatriz Souza');
    expect(answerStandard('email', field('Email'), ctx)!.value).toBe('ana.souza@example.com');
    expect(answerStandard('github', field('GitHub'), ctx)!.value).toBe('https://github.com/ana-souza-example');
    expect(answerStandard('portfolio', field('Website'), ctx)!.value).toBe('https://github.com/ana-souza-example');
    expect(answerStandard('location', field('Location'), ctx)!.value).toBe('São Paulo, SP, Brasil');
  });

  it('phone and dates follow the field format', () => {
    expect(formatPhone('+55 11 98765-4321', {})).toBe('+55 11 98765-4321');
    expect(formatPhone('11987654321', { placeholder: '(11) 99999-9999' })).toBe('(11) 98765-4321');
    expect(formatPhone('+55 (11) 98765-4321', { pattern: '[0-9]{11}' })).toBe('11987654321');
    expect(formatDate('2026-11-20', { type: 'date' })).toBe('2026-11-20');
    expect(formatDate('2026-11-20', { type: 'text', placeholder: 'DD/MM/AAAA' })).toBe('20/11/2026');
  });

  it('current company/title from the latest experience fact', () => {
    expect(answerStandard('current_company', field('Empresa atual'), ctx)).toMatchObject({ value: 'Xeno Tecnologia', evidence: ['f-exp1'] });
  });

  it('salary, notice, work authorization, relocation, work mode from personal facts', () => {
    expect(answerStandard('salary', field('Pretensão salarial'), ctx)).toMatchObject({ value: 'R$ 15.000 mensal (CLT)', evidence: ['p-salary'] });
    expect(answerStandard('salary', field('Salary', { type: 'number' }), ctx)!.value).toBe('15000');
    expect(answerStandard('salary', field('Faixa', { type: 'select', options: ['Até R$ 10.000', 'R$ 10.001 a R$ 15.000', 'Acima de R$ 15.000'] }), ctx)!.value).toBe('R$ 10.001 a R$ 15.000');
    expect(answerStandard('salary', field('What is your total ANNUAL compensation expectation?'), anaContext({ lang: 'en' }))!.value).toBe('BRL 180,000 per year (CLT)');
    expect(answerStandard('country', field('País', { type: 'select', options: ['Argentina', 'Brasil', 'Chile'] }), ctx)!.value).toBe('Brasil');
    expect(answerStandard('notice_period', field('Aviso prévio'), ctx)!.value).toBe('30 dias');
    expect(answerStandard('work_auth_brazil', field('Autorizada?', { type: 'radio', options: ['Sim', 'Não'] }), ctx)!.value).toBe('Sim');
    expect(answerStandard('sponsorship', field('Sponsorship?', { type: 'radio', options: ['Yes', 'No'] }), ctx)!.value).toBe('No');
    expect(answerStandard('relocate', field('Relocate?', { type: 'radio', options: ['Sim', 'Não'] }), ctx)!.value).toBe('Não');
    expect(answerStandard('work_mode', field('Modelo', { type: 'select', options: ['Presencial', 'Híbrido', 'Remoto'] }), ctx)!.value).toBe('Remoto');
  });

  it('missing facts never get invented: required → blocking missing_fact, optional → empty', () => {
    const empty = anaContext({ profile: { fullName: 'Ana Souza', email: 'a@b.co' }, personalIds: {} });
    expect(answerStandard('phone', field('Phone'), empty)).toMatchObject({ value: null, blocking: true, reason: 'missing_fact' });
    expect(answerStandard('linkedin', field('LinkedIn', { required: false }), empty)).toMatchObject({ value: null, blocking: false });
    expect(answerStandard('salary', field('Pretensão'), empty)).toMatchObject({ value: null, blocking: true, reason: 'missing_fact' });
  });

  it('PcD not stated → prefer-not option', () => {
    expect(answerStandard('pcd', field('Você é PcD?', { type: 'select', options: ['Sim', 'Não', 'Prefiro não informar'] }), anaContext())!.value).toBe('Prefiro não informar');
  });
});
