/**
 * CommunicationGraph (Task 40)
 *
 * Directed graph of allowed agent-to-agent communication flows.
 * Empty flows = unrestricted (backward compatible).
 */

import type { FlowEdge } from '../../../shared/src/types/communication-flow.js';

export class CommunicationGraph {
  private readonly adjacency = new Map<string, Set<string>>();
  private readonly reverse = new Map<string, Set<string>>();
  private readonly edges: FlowEdge[];
  private readonly unrestricted: boolean;

  constructor(flows: FlowEdge[]) {
    this.edges = [...flows];
    this.unrestricted = flows.length === 0;

    for (const [from, to] of flows) {
      if (!this.adjacency.has(from)) this.adjacency.set(from, new Set());
      this.adjacency.get(from)!.add(to);

      if (!this.reverse.has(to)) this.reverse.set(to, new Set());
      this.reverse.get(to)!.add(from);
    }
  }

  /** Check whether fromSlug is allowed to send to toSlug */
  isAuthorized(fromSlug: string, toSlug: string): boolean {
    if (this.unrestricted) return true;
    return this.adjacency.get(fromSlug)?.has(toSlug) === true;
  }

  /** Outbound targets for a given sender */
  getTargets(fromSlug: string): string[] {
    if (this.unrestricted) return [];
    return Array.from(this.adjacency.get(fromSlug) ?? []);
  }

  /** Inbound sources for a given receiver */
  getSources(toSlug: string): string[] {
    if (this.unrestricted) return [];
    return Array.from(this.reverse.get(toSlug) ?? []);
  }

  /** All declared edges */
  allEdges(): FlowEdge[] {
    return [...this.edges];
  }

  /** Detect cycles via DFS (returns true if at least one cycle exists) */
  hasCycles(): boolean {
    const WHITE = 0, GREY = 1, BLACK = 2;
    const color = new Map<string, number>();

    // Collect all nodes
    const nodes = new Set<string>();
    for (const [from, to] of this.edges) {
      nodes.add(from);
      nodes.add(to);
    }
    for (const n of nodes) color.set(n, WHITE);

    const dfs = (node: string): boolean => {
      color.set(node, GREY);
      for (const neighbor of this.adjacency.get(node) ?? []) {
        const c = color.get(neighbor) ?? WHITE;
        if (c === GREY) return true;
        if (c === WHITE && dfs(neighbor)) return true;
      }
      color.set(node, BLACK);
      return false;
    };

    for (const n of nodes) {
      if (color.get(n) === WHITE && dfs(n)) return true;
    }
    return false;
  }
}
