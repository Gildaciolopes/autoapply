import { isPlatformActionPage, isUnusualActivity } from './confirm.js';

export type Blocker = 'captcha' | 'bot_protection' | 'login_required' | 'unusual_activity' | 'platform_action';

export interface PageSnapshot {
  title: string;
  /** Visible text of the page (all frames), truncated. */
  text: string;
  /** src of iframes that are visible (≥ 20×20 px). */
  visibleIframes: string[];
  /** src of all scripts. */
  scripts: string[];
  hasPasswordField: boolean;
  /** Fillable fields found (all frames). */
  fieldCount: number;
  /** Visible elements of known captcha widgets (.g-recaptcha, .h-captcha, .cf-turnstile…). */
  captchaWidgets: number;
}

const CAPTCHA = /(recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com|arkoselabs|funcaptcha|geetest|captcha)/i;
const BOT_TITLE = /(just a moment|attention required|access denied|verify you are human|um momento|verificando se voc[eê] [eé] humano|checking your browser|pardon our interruption)/i;
const LOGIN_TEXT = /\b(sign in|log in|login|entrar|fa[cç]a login|create (an )?account|criar conta|cadastre-se)\b/i;

/**
 * Captcha / bot protection / login wall in the current step (research R7). The system never solves or
 * bypasses them: the caller stops with needs_input. Invisible captcha scripts that only act on submit
 * are reported as `captchaOnSubmit` (relevant for real submission in F5), not as a blocker.
 */
export function detectBlockers(s: PageSnapshot): { blocker: Blocker | null; captchaOnSubmit: boolean } {
  if (isUnusualActivity(`${s.title}\n${s.text}`)) return { blocker: 'unusual_activity', captchaOnSubmit: false };
  if (s.fieldCount <= 2 && isPlatformActionPage(s.text)) return { blocker: 'platform_action', captchaOnSubmit: false };
  if (BOT_TITLE.test(s.title) || (s.fieldCount === 0 && BOT_TITLE.test(s.text.slice(0, 2000)))) return { blocker: 'bot_protection', captchaOnSubmit: false };
  const visibleCaptcha = s.captchaWidgets > 0 || s.visibleIframes.some((src) => CAPTCHA.test(src) && !/invisible|size=invisible/.test(src));
  if (visibleCaptcha) return { blocker: 'captcha', captchaOnSubmit: false };
  const captchaOnSubmit = s.scripts.some((src) => CAPTCHA.test(src)) || s.visibleIframes.some((src) => CAPTCHA.test(src));
  if (s.hasPasswordField && s.fieldCount <= 4) return { blocker: 'login_required', captchaOnSubmit };
  if (s.fieldCount === 0 && LOGIN_TEXT.test(s.text.slice(0, 3000))) return { blocker: 'login_required', captchaOnSubmit };
  return { blocker: null, captchaOnSubmit };
}

const CLOSED = /(no longer accepting applications|this job is no longer available|job (posting )?(has been )?closed|position (has been )?filled|vaga (foi )?(encerrada|fechada|expirada|preenchida)|n[aã]o est[aá] mais (dispon[ií]vel|aceitando)|inscri[cç][oõ]es encerradas|the job you are looking for (is no longer|could not be found)|page not found|p[aá]gina n[aã]o encontrada)/i;

/** Posting closed / gone (FR US1-5). */
export function isClosedPosting(text: string, status?: number): boolean {
  return status === 404 || status === 410 || CLOSED.test(text.slice(0, 5000));
}
