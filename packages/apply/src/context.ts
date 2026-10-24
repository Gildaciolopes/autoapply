import type { ProfileFact } from '@autoapply/jobs';
import type { PersonalFacts, PersonalField } from '@autoapply/shared';

export interface ApplyProfile {
  fullName: string;
  email: string;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  linkedinUrl?: string | null;
  githubUser?: string | null;
  portfolio?: string | null;
}

/** Evidence id used for answers taken from the Profile row (contact data). */
export const PROFILE_EVIDENCE = 'profile:me';

/** Everything the answer pipeline may use. Facts are usable facts only (usableFactsWhere). */
export interface AnswerContext {
  profile: ApplyProfile | null;
  facts: ProfileFact[];
  personal: PersonalFacts;
  /** Fact id backing each personal field (only fields the user provided). */
  personalIds: Partial<Record<PersonalField, string>>;
  knownOrgs: string[];
  job: { title: string; company: string; description?: string | null };
  lang: 'pt' | 'en';
  now: Date;
}
