/**
 * Halt Signal (Task 35)
 *
 * JSONL-based broadcast/check for swarm-level halt signals.
 * When an agent triggers a cascade halt, other agents in the same swarm
 * can query whether a halt has been issued.
 */
import type { TerminationReason } from '../../../shared/src/types/termination.js';
/** Record written to the JSONL halt log. */
export interface HaltRecord {
    id: string;
    swarmId: string;
    sourceAgentId: string;
    reason: TerminationReason;
    haltedAt: string;
}
/**
 * Broadcast a halt signal for a swarm.
 */
export declare function broadcast(swarmId: string, sourceAgentId: string, reason: TerminationReason, filePath?: string): HaltRecord;
/**
 * Check whether any halt signal exists for the given swarm.
 */
export declare function isHalted(swarmId: string, filePath?: string): boolean;
//# sourceMappingURL=halt-signal.d.ts.map