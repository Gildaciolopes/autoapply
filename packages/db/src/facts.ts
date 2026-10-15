import type { Prisma, RunMode } from './generated/prisma/client.js';

/**
 * Constitution §I/§II: outside dry-run only verified, active, conflict-free facts may back a claim.
 * Every consumer (render, tailor, apply) must filter with this, never hand-roll the condition.
 */
export const usableFactsWhere = {
  verifiedByUser: true,
  status: 'active',
  hasOpenConflict: false,
} satisfies Prisma.FactWhereInput;

export function factsForMode(mode: RunMode): Prisma.FactWhereInput {
  return mode === 'dry_run' ? { status: 'active' } : usableFactsWhere;
}
