/**
 * FlowEnforcer (Task 40)
 *
 * Checks messages against the communication graph and records violations.
 * No database dependency — violations stored in memory.
 */
import type { FlowViolation } from '../../../shared/src/types/communication-flow.js';
import type { CommunicationGraph } from './communication-graph.js';
export declare class FlowEnforcer {
    private readonly graph;
    private readonly swarmId;
    private readonly enforce;
    private readonly violations;
    private static readonly MAX_VIOLATIONS;
    constructor(graph: CommunicationGraph, swarmId: string, enforceMode: boolean);
    /**
     * Check whether a message is authorized and record any violation.
     *
     * Returns BOTH `authorized` (the policy decision) and `enforced` (whether the
     * decision is actually applied). Callers must read both — taking action based
     * solely on `authorized` would let `enforce=false` silently bypass the policy.
     */
    checkAndRecord(fromSlug: string, toSlug: string, messageContent: string): {
        authorized: boolean;
        enforced: boolean;
        violation?: FlowViolation;
    };
    /** Return all recorded violations */
    getViolations(): FlowViolation[];
}
//# sourceMappingURL=flow-enforcer.d.ts.map