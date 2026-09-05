import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { MonographDb } from '../../storage/db.js';
import type { EdgeRelation } from '../../types.js';
import type { PipelinePhase } from '../types.js';
import { leiden } from './leiden.js';

export interface CommunitiesOutput {
  memberships: Map<string, number>;
  communityLabels: Map<number, string>;
  cohesionScores: Map<number, number>;
}

/**
 * The relation families that participate in clustering, and the weight each
 * family contributes to the clustering graph.
 *
 * This selection is deliberate, not incidental: different relations mean very
 * different things structurally, so they must not all count as the same
 * evidence of coupling.
 *
 * - **Coupling (weight 1)** — one symbol genuinely depends on another at
 *   runtime or type-check time. These are what a module boundary is supposed
 *   to contain, so they drive cluster boundaries.
 * - **Weak coupling (weight 0.5)** — real but indirect or partial links
 *   (pass-through re-exports, member access, framework wiring). They pull
 *   nodes together, but should not outvote a direct call or import.
 * - **Containment (weight 0.25)** — a file *owns* a symbol; it is not evidence
 *   that the two are coupled. Counted at full weight, containment dominates
 *   every real repo (there is one CONTAINS edge per symbol) and clustering
 *   degenerates into a restatement of the file tree. It is kept at a low weight
 *   only so that symbols with no coupling edges still attach to their parent
 *   rather than dropping out of the clustering entirely.
 *
 * Everything not listed is excluded: process/step relations (produced after
 * this phase runs), and the document-knowledge-graph families (REFERENCES,
 * PARENT_SECTION, TAGGED_AS, CO_OCCURS and the LLM-inferred prose relations),
 * which describe prose adjacency rather than code coupling.
 */
export const CLUSTERING_RELATION_WEIGHTS: Readonly<Partial<Record<EdgeRelation, number>>> = {
  // Coupling
  CALLS: 1,
  IMPORTS: 1,
  EXTENDS: 1,
  IMPLEMENTS: 1,
  // Weak coupling
  RE_EXPORTS: 0.5,
  METHOD_OVERRIDES: 0.5,
  METHOD_IMPLEMENTS: 0.5,
  ACCESSES: 0.5,
  QUERIES: 0.5,
  FETCHES: 0.5,
  HANDLES_ROUTE: 0.5,
  HANDLES_TOOL: 0.5,
  WRAPS: 0.5,
  // Containment
  CONTAINS: 0.25,
  DEFINES: 0.25,
  HAS_METHOD: 0.25,
  HAS_PROPERTY: 0.25,
  HAS_FIELD: 0.25,
  MEMBER_OF: 0.25,
};

export interface ClusteringEdge {
  sourceId: string;
  targetId: string;
  weight: number;
}

/**
 * Read the clustering input from the committed canonical graph — the `edges`
 * table this build has already written — rather than from any single phase's
 * in-memory output.
 *
 * This is the whole point of the query: edges produced by the resolution
 * phases (scope-resolution's resolved CALLS, bridge-resolver, wildcard
 * synthesis, mro, routes/tools/orm) are inserted straight into the DB and
 * never surface in `parse` or `cross-file` phase output. Clustering from those
 * outputs therefore ran over a thinner graph than the one every other consumer
 * queries. Reading the table means clustering sees exactly the edges the rest
 * of the system sees — filtered to the families selected above.
 *
 * The phase runs inside the build's open transaction on the same connection,
 * so it observes this build's writes.
 */
export function loadClusteringEdges(db: MonographDb): ClusteringEdge[] {
  const relations = Object.keys(CLUSTERING_RELATION_WEIGHTS);
  const placeholders = relations.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT source_id, target_id, relation FROM edges WHERE relation IN (${placeholders})`)
    .all(...relations) as Array<{ source_id: string; target_id: string; relation: EdgeRelation }>;

  return rows.map((r) => ({
    sourceId: r.source_id,
    targetId: r.target_id,
    weight: CLUSTERING_RELATION_WEIGHTS[r.relation] ?? 0,
  }));
}

/**
 * Build the weighted clustering graph. Louvain reads the `weight` attribute.
 *
 * The projection is **undirected**: "do these two symbols belong in the same
 * group" is a symmetric question, and modularity is defined over undirected
 * connectivity. Clustering the directed graph made the family weights above
 * inert — directed modularity would split a caller from its callee even when
 * the call edge was the heaviest link between them. A multigraph is used so
 * that parallel links between the same pair (e.g. a call in both directions,
 * or a call plus an import) add up rather than being discarded.
 */
function buildClusteringGraph(edges: ClusteringEdge[]): Graph {
  const graph = new Graph({ multi: true, type: 'undirected' });
  for (const edge of edges) {
    graph.mergeNode(edge.sourceId);
    graph.mergeNode(edge.targetId);
    graph.addEdge(edge.sourceId, edge.targetId, { weight: edge.weight });
  }
  return graph;
}

export function computeCohesion(
  communityId: number,
  memberships: Map<string, number>,
  edges: Array<{ sourceId: string; targetId: string }>,
): number {
  const members = [...memberships.entries()].filter(([, c]) => c === communityId).map(([id]) => id);
  const n = members.length;
  if (n <= 1) return 1;

  const memberSet = new Set(members);
  const maxEdges = (n * (n - 1)) / 2; // undirected: n*(n-1)/2
  if (maxEdges === 0) return 1;

  // Count unique undirected internal edges
  const seen = new Set<string>();
  let internalCount = 0;
  for (const e of edges) {
    if (memberSet.has(e.sourceId) && memberSet.has(e.targetId)) {
      const key = [e.sourceId, e.targetId].sort().join('\0');
      if (!seen.has(key)) {
        seen.add(key);
        internalCount++;
      }
    }
  }
  return internalCount / maxEdges;
}

/**
 * Compute cohesion scores for all communities in a single O(N+E) pass.
 *
 * This replaces calling `computeCohesion` inside a loop, which was O(K*(N+E))
 * because each call re-scanned all memberships (O(N)) and all edges (O(E)).
 *
 * The score is a structural measurement — the fraction of possible internal
 * pairs that are actually connected by a selected edge — and nothing more. It
 * is not a quality, health, or design-correctness judgment: a low score says
 * the clustering grouped nodes that have few links *among the relation
 * families listed in CLUSTERING_RELATION_WEIGHTS*, which can equally mean the
 * coupling is real but expressed through a family this phase excludes.
 *
 * @param memberships - nodeId → communityId map from the clustering step
 * @param edges - the same selected edge set that was clustered (see
 *   `loadClusteringEdges`), so the score describes the graph that produced the
 *   communities rather than some other edge set
 * @returns Map of communityId → internal-edge density ∈ [0, 1]
 */
export function computeAllCohesionScores(
  memberships: Map<string, number>,
  edges: Array<{ sourceId: string; targetId: string }>,
): Map<number, number> {
  // Single pass over memberships: build communityId → Set<nodeId>
  const memberSets = new Map<number, Set<string>>();
  for (const [nodeId, commId] of memberships) {
    let s = memberSets.get(commId);
    if (!s) {
      s = new Set();
      memberSets.set(commId, s);
    }
    s.add(nodeId);
  }

  // Single pass over edges: count unique undirected internal edges per community
  const internalEdgeCounts = new Map<number, number>();
  const seenEdgeKeys = new Map<number, Set<string>>();

  for (const e of edges) {
    const commSrc = memberships.get(e.sourceId);
    const commTgt = memberships.get(e.targetId);
    if (commSrc === undefined || commTgt === undefined || commSrc !== commTgt) continue;

    let seen = seenEdgeKeys.get(commSrc);
    if (!seen) {
      seen = new Set();
      seenEdgeKeys.set(commSrc, seen);
    }
    const key =
      e.sourceId < e.targetId ? `${e.sourceId}\0${e.targetId}` : `${e.targetId}\0${e.sourceId}`;
    if (!seen.has(key)) {
      seen.add(key);
      internalEdgeCounts.set(commSrc, (internalEdgeCounts.get(commSrc) ?? 0) + 1);
    }
  }

  // Compute final scores
  const scores = new Map<number, number>();
  for (const [commId, members] of memberSets) {
    const n = members.size;
    if (n <= 1) {
      scores.set(commId, 1);
      continue;
    }
    const maxEdges = (n * (n - 1)) / 2;
    const internalCount = internalEdgeCounts.get(commId) ?? 0;
    scores.set(commId, maxEdges > 0 ? internalCount / maxEdges : 1);
  }

  return scores;
}

/**
 * Community detection over the committed canonical graph.
 *
 * What the output does and does not claim: communities here are the clusters
 * a modularity-maximising algorithm (Leiden-style refinement over Louvain)
 * finds in the weighted edge set defined by `CLUSTERING_RELATION_WEIGHTS`.
 * They are a summary of *that* connectivity, and they have not been measured
 * against package manifests, directory layout, or runtime deployment units —
 * so a community is a candidate grouping to look at, not a verified
 * architectural module or package boundary. Any consumer that presents these
 * as architecture should say which basis it is using.
 *
 * `deps` lists every phase that writes a selected relation family into
 * `edges`, so that the table is complete when this phase reads it. Adding a
 * phase that emits a clustering relation means adding it here too.
 */
export const communitiesPhase: PipelinePhase<CommunitiesOutput> = {
  name: 'communities',
  deps: [
    'parse',
    'cross-file',
    'mro',
    'routes',
    'tools',
    'orm',
    'import-resolver',
    'scope-resolution',
    'bridge-resolver',
    'wildcard-synthesis',
  ],
  async execute(ctx) {
    if (ctx.allFilesCached) {
      return { memberships: new Map(), communityLabels: new Map(), cohesionScores: new Map() };
    }
    const allUsedEdges = loadClusteringEdges(ctx.db);

    const graph = buildClusteringGraph(allUsedEdges);
    let communities: Record<string, number> = {};
    try {
      communities = leiden(graph, { seed: 42 });
    } catch (e) {
      console.warn('[monograph] Leiden failed, falling back to Louvain:', e);
      try {
        communities = louvain(graph, { randomWalk: false });
      } catch {
        // Empty or disconnected graph
      }
    }

    const memberships = new Map<string, number>(
      Object.entries(communities).map(([k, v]) => [k, v]),
    );
    const communityLabels = new Map<number, string>();

    const communityDegrees = new Map<number, Map<string, number>>();
    for (const [nodeId, commId] of memberships) {
      if (!communityDegrees.has(commId)) communityDegrees.set(commId, new Map());
      const deg = graph.degree(nodeId) ?? 0;
      communityDegrees.get(commId)?.set(nodeId, deg);
    }
    for (const [commId, nodeDegs] of communityDegrees) {
      const topNode = [...nodeDegs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      communityLabels.set(commId, `community-${commId}(${topNode.slice(0, 20)})`);
    }

    // Compute all cohesion scores in one O(N+E) pass instead of O(K*(N+E))
    const cohesionScores = computeAllCohesionScores(memberships, allUsedEdges);

    // Persist community assignments to the DB
    if (memberships.size > 0) {
      const commSizes = new Map<number, number>();
      for (const commId of memberships.values()) {
        commSizes.set(commId, (commSizes.get(commId) ?? 0) + 1);
      }
      const updateNode = ctx.db.prepare('UPDATE nodes SET community_id = ? WHERE id = ?');
      const upsertComm = ctx.db.prepare(
        'INSERT OR REPLACE INTO communities (id, label, size, cohesion_score) VALUES (?, ?, ?, ?)',
      );
      ctx.db.transaction(() => {
        for (const [nodeId, commId] of memberships) {
          updateNode.run(commId, nodeId);
        }
        for (const [commId, label] of communityLabels) {
          upsertComm.run(
            commId,
            label,
            commSizes.get(commId) ?? 0,
            cohesionScores.get(commId) ?? 0,
          );
        }
      })();
    }

    return { memberships, communityLabels, cohesionScores };
  },
};

/**
 * Split a community that is too large into smaller sub-groups.
 * By graphify convention, communities >25% of total graph nodes are split.
 */
export function splitOversizedCommunity(memberIds: string[], maxGroupSize: number): string[][] {
  if (memberIds.length <= maxGroupSize) return [memberIds];
  const groups: string[][] = [];
  for (let i = 0; i < memberIds.length; i += maxGroupSize) {
    groups.push(memberIds.slice(i, i + maxGroupSize));
  }
  return groups;
}
