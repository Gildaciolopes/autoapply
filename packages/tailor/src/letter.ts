import { normalizeText } from '@autoapply/kb';

const LETTER_RE = /\b(carta de apresentacao|carta de motivacao|cover letter|motivation letter|carta de interesse)\b/;

/** FR-012: the job asks for a cover letter. */
export function requiresCoverLetter(jobText: string): boolean {
  return LETTER_RE.test(normalizeText(jobText));
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
