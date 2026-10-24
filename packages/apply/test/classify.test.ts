import { describe, expect, it } from 'vitest';
import { classifyField, formLanguage } from '../src/classify.js';
import type { FormField } from '@autoapply/shared';

type Case = [label: string, expected: string, over?: Partial<FormField>];

// Real labels seen on Greenhouse, Lever, Ashby and Brazilian career pages (pt/en).
const CASES: Case[] = [
  ['First Name', 'first_name'],
  ['Last Name', 'last_name'],
  ['Preferred First Name', 'first_name'],
  ['Nome', 'full_name'],
  ['Nome completo *', 'full_name'],
  ['Full name', 'full_name'],
  ['Sobrenome', 'last_name'],
  ['Email', 'email'],
  ['E-mail *', 'email'],
  ['Endereço de e-mail', 'email'],
  ['Phone', 'phone'],
  ['Telefone (WhatsApp)', 'phone'],
  ['Celular', 'phone'],
  ['Resume/CV', 'resume', { type: 'file' }],
  ['Currículo', 'resume', { type: 'file' }],
  ['Autofill from resume', 'other', { type: 'file' }],
  ['Cover Letter', 'cover_letter', { type: 'file' }],
  ['Carta de apresentação', 'cover_letter', { type: 'textarea' }],
  ['LinkedIn Profile', 'linkedin'],
  ['LinkedIn URL', 'linkedin', { type: 'url' }],
  ['Perfil do LinkedIn', 'linkedin'],
  ['GitHub', 'github'],
  ['GitHub URL', 'github', { type: 'url' }],
  ['Website', 'portfolio'],
  ['Portfolio', 'portfolio'],
  ['Site pessoal / portfólio', 'portfolio'],
  ['Current Company', 'current_company'],
  ['Empresa atual', 'current_company'],
  ['Cargo atual', 'current_title'],
  ['Current title', 'current_title'],
  ['Cidade', 'city'],
  ['City', 'city'],
  ['Estado', 'state'],
  ['Location', 'location'],
  ['País*', 'country'],
  ['Country', 'country'],
  ['Do you live with any disabilities?', 'pcd'],
  ['On Data Privacy*', 'consent', { type: 'select' }],
  ['Confidentiality Notice', 'consent', { type: 'select' }],
  ['Localização', 'location'],
  ['Where are you located?', 'location'],
  ['Pretensão salarial', 'salary'],
  ['Qual a sua pretensão salarial (CLT)?', 'salary'],
  ['Salary expectations', 'salary'],
  ['What are your compensation expectations?', 'salary'],
  ['Aviso prévio', 'notice_period'],
  ['What is your notice period?', 'notice_period'],
  ['When can you start?', 'available_from'],
  ['Data de início disponível', 'available_from'],
  ['Are you legally authorized to work in Brazil?', 'work_auth_brazil'],
  ['Você possui autorização para trabalhar no Brasil?', 'work_auth_brazil'],
  ['Will you now or in the future require visa sponsorship?', 'sponsorship'],
  ['Are you willing to relocate?', 'relocate'],
  ['Você tem disponibilidade para mudança de cidade?', 'relocate'],
  ['Modelo de trabalho preferido', 'work_mode'],
  ['Você é PcD (pessoa com deficiência)?', 'pcd'],
  ['Disability status', 'pcd'],
  ['Gender', 'demographic:gender'],
  ['Gênero', 'demographic:gender'],
  ['Raça/Cor', 'demographic:race'],
  ['Are you Hispanic/Latino?', 'demographic:race'],
  ['Veteran Status', 'demographic:veteran'],
  ['Orientação sexual', 'demographic:orientation'],
  ['Pronouns', 'demographic:pronouns'],
  ['I agree to the privacy policy', 'consent', { type: 'checkbox' }],
  ['Concordo com o tratamento dos meus dados conforme a LGPD', 'consent', { type: 'checkbox' }],
  ['How did you hear about us?', 'other'],
  ['Por que você quer trabalhar aqui?', 'other'],
  ['Do you have experience running LinkedIn Ads campaigns for B2B companies?', 'other'],
  ['Quantos anos de experiência você tem com Node.js?', 'other'],
  ['Anything else you would like to share?', 'other', { type: 'textarea' }],
];

const label = (c: ReturnType<typeof classifyField>) =>
  c.kind === 'standard' ? c.std : c.kind === 'demographic' ? `demographic:${c.demo}` : c.kind;

describe('classifyField (label corpus)', () => {
  it.each(CASES)('%s → %s', (l, expected, over) => {
    expect(label(classifyField({ label: l, type: 'text', ...over }))).toBe(expected);
  });

  it('uses name/autocomplete when the label is unhelpful', () => {
    expect(label(classifyField({ label: '', name: 'job_application[first_name]', type: 'text' }))).toBe('first_name');
    expect(label(classifyField({ label: 'Full name✱', name: '_systemfield_name', type: 'text' }))).toBe('full_name');
    expect(label(classifyField({ label: 'Profile', name: 'urls[LinkedIn]', type: 'text' }))).toBe('linkedin');
    expect(label(classifyField({ label: '', autocomplete: 'email', type: 'text' }))).toBe('email');
    expect(label(classifyField({ label: 'Attach', name: '_systemfield_resume', type: 'file' }))).toBe('resume');
    expect(label(classifyField({ label: 'Anexar', key: '[id="resume"]', type: 'file' }))).toBe('resume');
  });
});

describe('formLanguage', () => {
  it('majority of label words', () => {
    expect(formLanguage(['Nome', 'Sobrenome', 'What is your total annual compensation expectation?', 'Do you have any family members working at the company?'], 'pt')).toBe('en');
    expect(formLanguage(['Qual a sua pretensão salarial?', 'Você possui experiência com React?'], 'en')).toBe('pt');
  });
});
