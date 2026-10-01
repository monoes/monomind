// packages/@monomind/cli/src/orgrt/session-usage.ts
// Extracted from session.ts — token metering and usage events for a role session.
import type { AgentMessage } from './agent-runner.js';
import type { OrgBus } from './bus.js';
import type { CumulativeMeter } from './cumulative-meter.js';
import { isRecoverableCloseReason, type Mailbox } from './mailbox.js';
import type { PolicyEngine, TokenUsage } from './policy.js';

/** ADR-O001 D1 — token-metering helpers.
 *
 *  `cache_read_input_tokens` and `cache_creation_input_tokens` are siblings
 *  of `input_tokens` in the Anthropic API, not subsets of it, and both are
 *  billable. Everything below therefore sums all four. */
export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheRead + u.cacheCreation;
}

export function addTo(target: TokenUsage, add: TokenUsage): void {
  target.input += add.input;
  target.output += add.output;
  target.cacheRead += add.cacheRead;
  target.cacheCreation += add.cacheCreation;
}

/** One model turn's own usage, off an 'assistant' (or per-turn 'result')
 *  message. */
export function turnBreakdown(m: AgentMessage): TokenUsage {
  return {
    input: m.input_tokens ?? 0,
    output: m.output_tokens ?? 0,
    cacheRead: m.cache_read_input_tokens ?? 0,
    cacheCreation: m.cache_creation_input_tokens ?? 0,
  };
}

/** #597: an assistant message's usage not yet metered for its API response.
 *  A response split across several messages repeats its input/cache usage,
 *  and its earlier messages can carry placeholder output, so each field
 *  counts only its increase over the largest value already seen for that
 *  response id. A message without an id is counted as-is. */
export function newResponseUsage(seen: Map<string, TokenUsage>, m: AgentMessage): TokenUsage {
  const turn = turnBreakdown(m);
  if (!m.response_id) return turn;
  const prev = seen.get(m.response_id);
  if (!prev) {
    seen.set(m.response_id, turn);
    return turn;
  }
  const max: TokenUsage = {
    input: Math.max(prev.input, turn.input),
    output: Math.max(prev.output, turn.output),
    cacheRead: Math.max(prev.cacheRead, turn.cacheRead),
    cacheCreation: Math.max(prev.cacheCreation, turn.cacheCreation),
  };
  seen.set(m.response_id, max);
  return {
    input: max.input - prev.input,
    output: max.output - prev.output,
    cacheRead: max.cacheRead - prev.cacheRead,
    cacheCreation: max.cacheCreation - prev.cacheCreation,
  };
}

/** What a 'result' message says this mailbox message consumed.
 *
 *  When the runner reports `cumulative_tokens` (the Claude SDK's whole-pipeline
 *  `modelUsage`, which unlike `usage` includes Task subagents and sidechains),
 *  that value is CUMULATIVE per session — the same lifecycle as
 *  `total_cost_usd` — so it is converted to a delta by the meter (see
 *  cumulative-meter.ts). Without `cumulative_tokens` the per-turn fields are
 *  used as before. */
export function resultBreakdown(
  m: AgentMessage,
  tokenTotals: CumulativeMeter<TokenUsage> | undefined,
  sid: string,
): TokenUsage {
  const cum = m.cumulative_tokens;
  if (!cum) return turnBreakdown(m);
  const now: TokenUsage = {
    input: cum.input,
    output: cum.output,
    cacheRead: cum.cache_read,
    cacheCreation: cum.cache_creation,
  };
  return tokenTotals ? tokenTotals.delta(sid, now) : now;
}

/** ADR-O001 D1: the four quantities travel separately so every downstream
 *  consumer (forwarder → dashboard state.json, reporting, `org costs`) can
 *  record real values instead of the 0s they used to persist. `tokens` stays
 *  the single billable total. */
export function emitUsage(
  bus: OrgBus,
  from: string,
  t: TokenUsage,
  costUsd: number | undefined,
  subtype: string | undefined,
): void {
  bus.emit({
    type: 'usage',
    from,
    data: {
      tokens: totalTokens(t),
      // null, not omitted, when the runtime reported no cost (unknown ≠ $0).
      cost_usd: costUsd ?? null,
      subtype,
      tokens_in: t.input,
      tokens_out: t.output,
      cache_read: t.cacheRead,
      cache_creation: t.cacheCreation,
    },
  });
}

/** The 'result' message's side of a mailbox message's token accounting.
 *
 *  Per the SDK's own type docs, a 'result' message's usage is that message's
 *  own (effectively last-turn) usage in streaming-input mode, NOT a
 *  cumulative total across every turn of the mailbox message — and that last
 *  turn was already counted via its own 'assistant' message (`turns`),
 *  specifically so overBudget could trip mid-message. Adding the result's own
 *  usage again unconditionally would double-count it. (A modelUsage-derived
 *  delta is per-session-cumulative, so the same subtraction is exactly right
 *  there too: it removes what the assistant turns of THIS message already
 *  contributed and leaves the subagent/auxiliary volume the main loop never
 *  reported.) Only the shortfall (never negative) is added to the meter, so a
 *  turn whose usage never reached the 'assistant' branch (e.g. a runner/test
 *  double that doesn't emit per-turn usage) still gets counted once.
 *
 *  Returns what the whole mailbox message added to the meter — the per-turn
 *  accounting plus the top-up — which is what the 'usage' event reports, so a
 *  consumer summing events lands on the same number as policy.usage. */
export function settleResultTokens(
  policy: PolicyEngine,
  result: TokenUsage,
  turns: TokenUsage,
): TokenUsage {
  const shortfall: TokenUsage = {
    input: Math.max(0, result.input - turns.input),
    output: Math.max(0, result.output - turns.output),
    cacheRead: Math.max(0, result.cacheRead - turns.cacheRead),
    cacheCreation: Math.max(0, result.cacheCreation - turns.cacheCreation),
  };
  if (totalTokens(shortfall) > 0) policy.addTokenUsage(shortfall);
  const message = { ...turns };
  addTo(message, shortfall);
  return message;
}

/** #550: AgentRunArgs.tokenBudget for a session — what the role may still
 *  spend on the budgeted basis. 0 once its mailbox was closed for budget
 *  (its own cap, budget_usd, or the org-wide ceiling, which closes every
 *  mailbox without touching the role's own meter). */
export function sessionTokenBudget(
  policy: PolicyEngine,
  mailbox: Mailbox,
): { left: number; max?: number } | undefined {
  if (mailbox.isClosed && isRecoverableCloseReason(mailbox.closeReason)) return { left: 0 };
  const max = policy.policy.maxTokens;
  if (max == null) return undefined;
  return { left: Math.max(0, max - policy.budgetedUsage), max };
}
