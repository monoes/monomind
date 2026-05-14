/**
 * CommunicationGraph (Task 40)
 *
 * Directed graph of allowed agent-to-agent communication flows.
 * Empty flows = unrestricted (backward compatible).
 */
import type { FlowEdge } from '../../../shared/src/types/communication-flow.js';
export declare class CommunicationGraph {
    private readonly adjacency;
    private readonly reverse;
    private readonly edges;
    private readonly unrestricted;
    constructor(flows: FlowEdge[]);
    /** Check whether fromSlug is allowed to send to toSlug */
    isAuthorized(fromSlug: string, toSlug: string): boolean;
    /** Outbound targets for a given sender */
    getTargets(fromSlug: string): string[];
    /** Inbound sources for a given receiver */
    getSources(toSlug: string): string[];
    /** All declared edges */
    allEdges(): FlowEdge[];
    /** Detect cycles via DFS (returns true if at least one cycle exists) */
    hasCycles(): boolean;
}
//# sourceMappingURL=communication-graph.d.ts.map