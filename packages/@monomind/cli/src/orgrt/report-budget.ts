// packages/@monomind/cli/src/orgrt/report-budget.ts
// `org report`'s per-role token column. The budget % is computed on the same
// basis policy.ts budgetedUsage enforces `budget_tokens` on — input+output
// unless the org opts into `budget_tokens_basis: 'billable'` — so a
// well-cached role no longer reads EXHAUSTED at a few percent of its real
// budget. Cache tokens are still shown, labelled as such.
import type { RoleStats } from './reporting.js';

export type TokenBasis = 'uncached' | 'billable';

export function roleTokensNote(
  r: Pick<RoleStats, 'tokens' | 'uncachedTokens'>,
  cap: number | undefined,
  basis: TokenBasis,
): string {
  const cache = r.tokens - r.uncachedTokens;
  const split = cache > 0 ? ` (${r.uncachedTokens} in+out, ${cache} cache)` : '';
  if (!cap) return `${r.tokens} tokens${split}`;
  const used = basis === 'billable' ? r.tokens : r.uncachedTokens;
  const pct = Math.round((used / cap) * 100);
  const label = basis === 'billable' ? 'billable' : 'in+out';
  const flag = pct >= 100 ? ' — EXHAUSTED' : pct >= 80 ? ' — near limit' : '';
  return `${r.tokens} tokens${split} (${pct}% of ${cap} ${label}${flag})`;
}
