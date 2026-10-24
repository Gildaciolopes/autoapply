import { normalizeText } from './options.js';

const SUBMITTED = /\b(candidatura (foi )?(enviada|recebida|realizada|concluida)|recebemos (a )?sua candidatura|inscricao (realizada|concluida|confirmada)|application (has been )?(submitted|received|sent)|thank(s| you) for (applying|your application|your interest)|your application (was|has been) (sent|submitted|received)|sua candidatura foi enviada|we ve received your application)\b/;
const SUBMITTED_URL = /\/(confirmation|confirmacao|thank-?you|obrigado|sucesso|success|applied)(\/|\?|$)/i;

/** The page shows that the application was received (pt/en). */
export function isSubmittedConfirmation(text: string, url = ''): boolean {
  return SUBMITTED.test(normalizeText(text.slice(0, 20000))) || SUBMITTED_URL.test(url);
}

const ALREADY = /\b(voce ja se candidatou|ja se candidatou a esta vaga|voce ja esta participando|ja se inscreveu|candidatura ja realizada|you (have )?already applied|you applied|applied \d+ (minutes?|hours?|days?|weeks?) ago|candidatou se ha \d+)\b/;

export function isAlreadyApplied(text: string): boolean {
  return ALREADY.test(normalizeText(text.slice(0, 20000)));
}

const UNUSUAL = /\b(atividade incomum|unusual activity|muitas tentativas|too many requests|tente novamente mais tarde|try again later|temporariamente restrit\w*|temporarily restricted|we ve restricted)\b/;

/** Rate limits / account warnings: the platform must be paused (FR-012). */
export function isUnusualActivity(text: string, status?: number | null): boolean {
  return status === 429 || status === 999 || UNUSUAL.test(normalizeText(text.slice(0, 8000)));
}

const ACTION = /\b(atualizamos (nossos )?termos|aceite os (novos )?termos|accept the (updated )?terms|verifique seu (e ?mail|telefone|numero)|verify your (email|phone|identity)|confirme seu (e ?mail|telefone)|confirm your (email|phone))\b/;

/** Pages that need the user's own action on the platform (terms, verification): never done for them. */
export function isPlatformActionPage(text: string): boolean {
  return ACTION.test(normalizeText(text.slice(0, 8000)));
}
