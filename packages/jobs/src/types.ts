export type { JudgeResult, MatchedEvidence, Preferences } from '@autoapply/shared';
/** Structural copy of @autoapply/llm ChatMessage (keeps this package free of the LLM dependency). */
export interface ChatMessageLike {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
