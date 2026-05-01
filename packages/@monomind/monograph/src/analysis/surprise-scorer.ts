// ── Types ──────────────────────────────────────────────────────────────────────

export interface ScoredNode {
  id: string;
  degree: number;           // total in+out edges
  avgDegree: number;        // average degree across the graph
  crossCommunityEdges: number;  // edges crossing community boundaries
  totalEdges: number;       // total edges (for ratio)
  stalenessScore: number;   // 0=fresh, 1=stale
  communityId?: string;
}

export interface SurpriseOptions {
  degreeWeight?: number;        // default 0.4
  crossCommunityWeight?: number; // default 0.4
  stalenessWeight?: number;     // default 0.2
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Compute a multi-factor surprise score for a single node.
 *
 * The score combines:
 * - Degree anomaly: how far the node's degree deviates from the graph average
 * - Cross-community ratio: what fraction of edges cross community boundaries
 * - Staleness: how stale the node is (from git-based staleness scoring)
 *
 * @returns A value in [0, 1] where higher means more surprising / worth investigating.
 */
export function computeSurpriseScore(node: ScoredNode, opts: SurpriseOptions = {}): number {
  const degreeWeight = opts.degreeWeight ?? 0.4;
  const crossCommunityWeight = opts.crossCommunityWeight ?? 0.4;
  const stalenessWeight = opts.stalenessWeight ?? 0.2;

  // Factor 1: degree anomaly — nodes with unusually high or low connectivity
  const degreeAnomaly = clamp(
    Math.abs(node.degree - node.avgDegree) / (node.avgDegree + 1),
    0,
    1,
  );

  // Factor 2: cross-community ratio — edges that bridge different communities
  const crossCommunityRatio = node.totalEdges > 0
    ? node.crossCommunityEdges / node.totalEdges
    : 0;

  // Factor 3: staleness — stale nodes are surprising because they may be outdated
  const staleness = clamp(node.stalenessScore, 0, 1);

  return degreeWeight * degreeAnomaly
    + crossCommunityWeight * crossCommunityRatio
    + stalenessWeight * staleness;
}

// ── Batch helper ──────────────────────────────────────────────────────────────

/**
 * Score a collection of nodes and return them sorted by surprise score descending.
 */
export function scoreNodes(
  nodes: ScoredNode[],
  opts?: SurpriseOptions,
): Array<ScoredNode & { surpriseScore: number }> {
  return nodes
    .map(node => ({ ...node, surpriseScore: computeSurpriseScore(node, opts) }))
    .sort((a, b) => b.surpriseScore - a.surpriseScore);
}
