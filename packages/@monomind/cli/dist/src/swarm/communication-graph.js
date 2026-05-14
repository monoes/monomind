/**
 * CommunicationGraph (Task 40)
 *
 * Directed graph of allowed agent-to-agent communication flows.
 * Empty flows = unrestricted (backward compatible).
 */
export class CommunicationGraph {
    adjacency = new Map();
    reverse = new Map();
    edges;
    unrestricted;
    constructor(flows) {
        this.edges = [...flows];
        this.unrestricted = flows.length === 0;
        for (const [from, to] of flows) {
            if (!this.adjacency.has(from))
                this.adjacency.set(from, new Set());
            this.adjacency.get(from).add(to);
            if (!this.reverse.has(to))
                this.reverse.set(to, new Set());
            this.reverse.get(to).add(from);
        }
    }
    /** Check whether fromSlug is allowed to send to toSlug */
    isAuthorized(fromSlug, toSlug) {
        if (this.unrestricted)
            return true;
        return this.adjacency.get(fromSlug)?.has(toSlug) === true;
    }
    /** Outbound targets for a given sender */
    getTargets(fromSlug) {
        if (this.unrestricted)
            return [];
        return Array.from(this.adjacency.get(fromSlug) ?? []);
    }
    /** Inbound sources for a given receiver */
    getSources(toSlug) {
        if (this.unrestricted)
            return [];
        return Array.from(this.reverse.get(toSlug) ?? []);
    }
    /** All declared edges */
    allEdges() {
        return [...this.edges];
    }
    /** Detect cycles via DFS (returns true if at least one cycle exists) */
    hasCycles() {
        const WHITE = 0, GREY = 1, BLACK = 2;
        const color = new Map();
        // Collect all nodes
        const nodes = new Set();
        for (const [from, to] of this.edges) {
            nodes.add(from);
            nodes.add(to);
        }
        for (const n of nodes)
            color.set(n, WHITE);
        const dfs = (node) => {
            color.set(node, GREY);
            for (const neighbor of this.adjacency.get(node) ?? []) {
                const c = color.get(neighbor) ?? WHITE;
                if (c === GREY)
                    return true;
                if (c === WHITE && dfs(neighbor))
                    return true;
            }
            color.set(node, BLACK);
            return false;
        };
        for (const n of nodes) {
            if (color.get(n) === WHITE && dfs(n))
                return true;
        }
        return false;
    }
}
//# sourceMappingURL=communication-graph.js.map