// packages/@monomind/cli/src/orgrt/runner-usage.ts
/**
 * #550: token metering and the budget gate for the codex and antigravity
 * runners.
 *
 * METER. Both CLIs count input the OpenAI/Gemini way: `input_tokens` is the
 * whole prompt, and the cached part is a count INSIDE it — codex
 * `turn.completed.usage` { input_tokens: 13085, cached_input_tokens: 9984 },
 * agy `usage` { input_tokens, cache_read_tokens, total_tokens } where
 * total_tokens = input + output, so the cache is not a separate addend. The
 * org meter uses the Anthropic convention instead (ADR-O001 D1):
 * `input_tokens` is the uncached remainder and the cache counts are
 * siblings, and budget_tokens is charged on input + output only. Passing
 * the CLI's total through charged every cached token as uncached — one
 * codex/agy turn spent 7-35x a role's ceiling, and the org-wide cap (the
 * sum of the same numbers) closed every other role. splitCachedInput moves
 * the cached part into cacheRead / cacheCreation; the total is unchanged.
 *
 * GATE. Neither CLI reports usage while a model call runs: agy reports it
 * per completed step, codex only once per `codex exec` (a whole agent run).
 * The runners therefore report each step/exec as it completes (a usage-only
 * 'assistant' message, which session-run meters and budget-checks the way
 * it does a Claude turn), stop an agy exec at the step that exhausts the
 * budget, and refuse to START an exec when the budget left is below
 * PRE_TURN_FLOOR_FRACTION of the ceiling. A codex exec that has started
 * still runs to its end — that overspend cannot be prevented from outside.
 */
import type { AgentMessage, AgentRunArgs } from './agent-runner-types.js';

export interface CliUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export const noUsage = (): CliUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });

const count = (n: number | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;

/** Split a CLI's total input (cache included) into the uncached remainder
 *  and its cache parts. A cache count above the total (agy has reported
 *  cache_read_tokens slightly over input_tokens) is clamped to it. */
export function splitCachedInput(u: {
  input?: number;
  output?: number;
  cached?: number;
  cacheWrite?: number;
}): CliUsage {
  const total = count(u.input);
  const cacheRead = Math.min(count(u.cached), total);
  const cacheCreation = Math.min(count(u.cacheWrite), total - cacheRead);
  return {
    input: total - cacheRead - cacheCreation,
    output: count(u.output),
    cacheRead,
    cacheCreation,
  };
}

export function addUsage(target: CliUsage, add: CliUsage): void {
  target.input += add.input;
  target.output += add.output;
  target.cacheRead += add.cacheRead;
  target.cacheCreation += add.cacheCreation;
}

/** What `total` has beyond `already`, never negative. Input is compared as
 *  the CLI's whole input (uncached + cache) and only then split, so two
 *  reports that split the same input differently between uncached and cache
 *  do not leave a phantom remainder in either part. */
export function usageBeyond(total: CliUsage, already: CliUsage): CliUsage {
  const whole = (u: CliUsage): number => u.input + u.cacheRead + u.cacheCreation;
  return splitCachedInput({
    input: Math.max(0, whole(total) - whole(already)),
    output: Math.max(0, total.output - already.output),
    cached: Math.max(0, total.cacheRead - already.cacheRead),
    cacheWrite: Math.max(0, total.cacheCreation - already.cacheCreation),
  });
}

/** Meter for a CLI that reports a step's usage (total input, cache
 *  included) and may report the same step more than once (agy: ACTIVE, then
 *  DONE): returns each report's growth over what was already reported for
 *  that step, or undefined when there is none. Each step's usage must be that
 *  step's own model call, not a running total: verified live against agy
 *  1.2.14 (#550) — four agent_response steps reported input 12374, 12859,
 *  13184 and 13497 and output 285, 125, 113 and 492, and result.usage was
 *  their exact sum (51914 / 1015). A report with no step key counts on its
 *  own (the caller gives it an ordinal). */
export function stepMeter(): (
  step: number | string,
  raw: Parameters<typeof splitCachedInput>[0],
) => CliUsage | undefined {
  const reported = new Map<number | string, CliUsage>();
  return (step, raw) => {
    const now = splitCachedInput(raw);
    const growth = usageBeyond(now, reported.get(step) ?? noUsage());
    reported.set(step, now);
    return growth.input + growth.output + growth.cacheRead + growth.cacheCreation > 0
      ? growth
      : undefined;
  };
}

/** `u` in AgentMessage field names (Anthropic convention). */
export function usageFields(u: CliUsage): Partial<AgentMessage> {
  return {
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_input_tokens: u.cacheRead,
    cache_creation_input_tokens: u.cacheCreation,
  };
}

/** A usage-only 'assistant' message (no text) for one completed step or
 *  exec, or undefined when there is nothing to report. */
export function usageMessage(u: CliUsage, sessionId: string | undefined): AgentMessage | undefined {
  if (u.input + u.output + u.cacheRead + u.cacheCreation === 0) return undefined;
  return { type: 'assistant', session_id: sessionId, ...usageFields(u) };
}

/** 'result' subtype for a mailbox message the runner stopped, or never
 *  started, because the budget ran out. session-run closes the role for
 *  budget on it instead of counting a failed turn. */
export const BUDGET_STOP_SUBTYPE = 'error_budget';

/** The Claude SDK's 'result' subtype when a query reaches its maxBudgetUsd
 *  (set from the role's remaining budget_usd). Also what the Claude runner
 *  reports when it starts no query because the USD budget is spent. A budget
 *  stop, not a failed turn. */
export const USD_STOP_SUBTYPE = 'error_max_budget_usd';

/** Budget share below which a runner will not start another CLI exec. */
export const PRE_TURN_FLOOR_FRACTION = 0.05;

/** Tokens a role must have left for a floor-gated runner to start an exec. */
export const turnFloor = (max: number): number => Math.ceil(max * PRE_TURN_FLOOR_FRACTION);

/** True once the budget is spent (or the session was closed for budget). */
export function budgetExhausted(args: Pick<AgentRunArgs, 'tokenBudget'>): boolean {
  const b = args.tokenBudget?.();
  return b !== undefined && b.left <= 0;
}

/** Why a runner must not start another CLI exec, or undefined when it may. */
export function budgetRefusal(args: Pick<AgentRunArgs, 'tokenBudget'>): string | undefined {
  const b = args.tokenBudget?.();
  if (!b) return undefined;
  if (b.left <= 0) return 'token budget exhausted';
  if (b.max !== undefined && b.left < turnFloor(b.max))
    return `only ${b.left} of ${b.max} budget_tokens left, below the ${PRE_TURN_FLOOR_FRACTION * 100}% floor a CLI turn needs`;
  return undefined;
}
