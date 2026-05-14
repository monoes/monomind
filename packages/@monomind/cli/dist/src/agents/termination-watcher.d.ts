/**
 * Termination Watcher (Task 35)
 *
 * Monitors agent run state and checks termination conditions.
 * Persists termination events to JSONL.
 */
import type { TerminationPolicy, TerminationEvent } from '../../../shared/src/types/termination.js';
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
/**
 * Check whether an agent should be terminated based on its current state,
 * last output, and the effective termination policy.
 *
 * Returns a `TerminationEvent` if a condition is met, or `null` if the
 * agent is still within bounds.
 */
export declare function check(state: AgentRunState, lastOutput: string, policy?: Partial<TerminationPolicy>): TerminationEvent | null;
/**
 * Persist a termination event to the JSONL log.
 */
export declare function persistEvent(event: TerminationEvent, filePath?: string): void;
//# sourceMappingURL=termination-watcher.d.ts.map