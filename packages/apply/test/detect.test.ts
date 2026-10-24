import { describe, expect, it } from 'vitest';
import { detectAts } from '../src/detect.js';
import { detectBlockers, isClosedPosting, type PageSnapshot } from '../src/blockers.js';

describe('detectAts', () => {
  it('greenhouse board, new board and embed urls', () => {
    expect(detectAts('https://boards.greenhouse.io/nubank/jobs/5678901')).toMatchObject({ ats: 'greenhouse', board: 'nubank', jobId: '5678901', formUrl: 'https://job-boards.greenhouse.io/nubank/jobs/5678901' });
    expect(detectAts('https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x')).toMatchObject({ ats: 'greenhouse', board: 'acme', jobId: '123' });
    expect(detectAts('https://boards.greenhouse.io/embed/job_app?for=acme&token=999')).toMatchObject({ ats: 'greenhouse', board: 'acme', jobId: '999' });
  });
  it('company page embedding greenhouse', () => {
    const html = '<div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>';
    expect(detectAts('https://acme.com/careers?gh_jid=4242', html)).toMatchObject({ ats: 'greenhouse', board: 'acme', jobId: '4242' });
    expect(detectAts('https://acme.com/vaga', '<iframe src="https://boards.greenhouse.io/embed/job_app?for=acme&amp;token=77">')).toMatchObject({ ats: 'greenhouse', jobId: '77' });
  });
  it('lever and ashby', () => {
    expect(detectAts('https://jobs.lever.co/acme/0b1c2d3e-0000-4000-8000-000000000000')).toMatchObject({ ats: 'lever', board: 'acme', formUrl: 'https://jobs.lever.co/acme/0b1c2d3e-0000-4000-8000-000000000000/apply' });
    expect(detectAts('https://jobs.lever.co/acme/0b1c2d3e-0000-4000-8000-000000000000/apply').formUrl).toMatch(/\/apply$/);
    expect(detectAts('https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-000000000000')).toMatchObject({ ats: 'ashby', board: 'acme', formUrl: 'https://jobs.ashbyhq.com/acme/0b1c2d3e-0000-4000-8000-000000000000/application' });
  });
  it('gupy and linkedin', () => {
    expect(detectAts('https://acme.gupy.io/jobs/9876543?jobBoardSource=gupy_public_page')).toMatchObject({ ats: 'gupy', board: 'acme', jobId: '9876543' });
    expect(detectAts('https://portal.gupy.io/job-search/term=dev').ats).toBe('generic');
    expect(detectAts('https://www.linkedin.com/jobs/view/4012345678/?refId=x')).toMatchObject({ ats: 'linkedin', jobId: '4012345678', formUrl: 'https://www.linkedin.com/jobs/view/4012345678/' });
    expect(detectAts('https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=dev')).toMatchObject({ ats: 'linkedin', jobId: '4012345678' });
    expect(detectAts('https://www.linkedin.com/in/someone').ats).toBe('generic');
  });
  it('anything else is generic', () => {
    expect(detectAts('https://carreiras.empresa.com.br/vaga/123')).toEqual({ ats: 'generic', formUrl: 'https://carreiras.empresa.com.br/vaga/123' });
  });
});

const snap = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({ title: 'Apply', text: '', visibleIframes: [], scripts: [], hasPasswordField: false, fieldCount: 8, captchaWidgets: 0, ...over });

describe('detectBlockers (never solved)', () => {
  it('visible captcha blocks; invisible submit-time captcha is only flagged', () => {
    expect(detectBlockers(snap({ visibleIframes: ['https://www.google.com/recaptcha/api2/anchor?k=x'] })).blocker).toBe('captcha');
    expect(detectBlockers(snap({ captchaWidgets: 1 })).blocker).toBe('captcha');
    expect(detectBlockers(snap({ scripts: ['https://js.hcaptcha.com/1/api.js?render=explicit'] }))).toEqual({ blocker: null, captchaOnSubmit: true });
  });
  it('bot protection and login walls', () => {
    expect(detectBlockers(snap({ title: 'Just a moment...', fieldCount: 0 })).blocker).toBe('bot_protection');
    expect(detectBlockers(snap({ hasPasswordField: true, fieldCount: 2 })).blocker).toBe('login_required');
    expect(detectBlockers(snap({ fieldCount: 0, text: 'Faça login para se candidatar' })).blocker).toBe('login_required');
    expect(detectBlockers(snap()).blocker).toBeNull();
  });
  it('closed postings', () => {
    expect(isClosedPosting('Sorry, this job is no longer available.')).toBe(true);
    expect(isClosedPosting('Esta vaga foi encerrada', 200)).toBe(true);
    expect(isClosedPosting('Apply now', 404)).toBe(true);
    expect(isClosedPosting('Apply for this job')).toBe(false);
  });
});
