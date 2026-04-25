/**
 * Termination Watcher (Task 35)
 *
 * Monitors agent run state and checks termination conditions.
 * Persists termination events to JSONL.
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import type {
  TerminationPolicy,
  TerminationEvent,
  TerminationReason,
} from '../../../shared/src/types/termination.js';
import { DEFAULT_TERMINATION_POLICY } from '../../../shared/src/types/termination.js';

/** Live state of a running agent. */
export interface AgentRunState {
  agentId: string;
  agentSlug: string;
  swarmId?: string;
  turnCount: number;
  cumulativeCostUsd: number;
  startedAt: Date;
  consecutiveFailures: number;
}

/** Reasons that trigger cascade halt (hard failures). */
const CASCADE_REASONS: Set<TerminationReason> = new Set([
  'max_turns_exceeded',
  'max_cost_exceeded',
  'timeout',
  'max_retries_exceeded',
]);

/**
 * Check whether an agent should be terminated based on its current state,
 * last output, and the effective termination policy.
 *
 * Returns a `TerminationEvent` if a condition is met, or `null` if the
 * agent is still within bounds.
 */
export function check(
  state: AgentRunState,
  lastOutput: string,
  policy?: Partial<TerminationPolicy>,
): TerminationEvent | null {
  const effective: Required<TerminationPolicy> = {
    ...DEFAULT_TERMINATION_POLICY,
    ...policy,
  };

  // 1. Max turns
  if (state.turnCount >= effective.maxTurns) {
    return buildEvent(state, 'max_turns_exceeded', state.turnCount);
  }

  // 2. Max cost
  if (state.cumulativeCostUsd >= effective.maxCostUsd) {
    return buildEvent(state, 'max_cost_exceeded', state.cumulativeCostUsd);
  }

  // 3. Timeout
  const elapsed = Date.now() - state.startedAt.getTime();
  if (elapsed >= effective.timeoutMs) {
    return buildEvent(state, 'timeout', elapsed);
  }

  // 4. Stop phrases
  for (const phrase of effective.stopOnPhrases) {
    if (lastOutput.includes(phrase)) {
      return buildEvent(state, 'stop_phrase_matched', phrase);
    }
  }

  // 5. Max retries (consecutive failures)
  if (state.consecutiveFailures >= effective.maxRetries) {
    return buildEvent(state, 'max_retries_exceeded', state.consecutiveFailures);
  }

  return null;
}

function buildEvent(
  state: AgentRunState,
  reason: TerminationReason,
  triggeredValue: number | string,
): TerminationEvent {
  return {
    eventId: randomUUID(),
    agentId: state.agentId,
    agentSlug: state.agentSlug,
    reason,
    triggeredValue,
    swarmId: state.swarmId,
    terminatedAt: new Date(),
    cascadeHalt: CASCADE_REASONS.has(reason),
  };
}

/**
 * Persist a termination event to the JSONL log.
 */
export function persistEvent(
  event: TerminationEvent,
  filePath?: string,
): void {
  const target = filePath ?? join(process.cwd(), 'data', 'termination-events.jsonl');
  const dir = dirname(target);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const serialized = {
    ...event,
    terminatedAt:
      event.terminatedAt instanceof Date
        ? event.terminatedAt.toISOString()
        : String(event.terminatedAt),
  };
  appendFileSync(target, JSON.stringify(serialized) + '\n', 'utf-8');
}
