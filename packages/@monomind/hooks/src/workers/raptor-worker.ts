/**
 * RAPTOR — Recursive Abstractive Tree Indexing for Retrieval
 *
 * Builds a persistent tree of cluster summaries during background consolidation:
 *   - Leaf nodes  = raw episodic memory entries
 *   - Parent nodes = LLM-generated abstractions of clusters
 *
 * The tree is stored within the existing `MemoryTier` taxonomy:
 *   episodic (leaves) → contextual (summaries)
 *
 * Retrieval can happen at any level, enabling both fine-grained lookup and
 * high-level thematic reasoning in a single index, +20 absolute points on the
 * QuALITY benchmark.
 *
 * Paper: arXiv:2401.18059 — RAPTOR: Recursive Abstractive Processing for Tree-Organised Retrieval (ICLR 2024)
 *
 * Call sites:
 *   - `createLearningWorker()` (periodic background consolidation)
 *   - `consolidate` background worker
 *
 * @module v1/hooks/workers/raptor-worker
 */

// ============================================================
// Types
// ============================================================

export interface RaptorEntry {
  /** Entry ID from MemoryEntry.id */
  id: string;
  /** Text content to cluster and summarise */
  content: string;
  /** Optional embedding (Float32Array serialised as number[]) */
  embedding?: number[];
  /** Namespace — used to scope clustering */
  namespace?: string;
}

export interface RaptorCluster {
  /** Cluster index */
  clusterId: number;
  /** Entry IDs belonging to this cluster */
  memberIds: string[];
  /** Cluster centroid (average embedding) */
  centroid?: number[];
  /** LLM-generated / pattern-generated summary */
  summary: string;
  /** Tier for the summary entry */
  tier: 'contextual';
}

export interface RaptorResult {
  /** Clusters discovered */
  clusters: RaptorCluster[];
  /** Total entries processed */
  totalEntries: number;
  /** Cluster summaries formatted for storage as contextual-tier entries */
  summaryEntries: Array<{
    key: string;
    content: string;
    namespace: string;
    memberIds: string[];
  }>;
  /** Processing duration ms */
  durationMs: number;
}

export interface RaptorConfig {
  /**
   * Target number of entries per cluster.
   * Smaller = finer-grained summaries. Default: 5.
   */
  clusterSize?: number;
  /**
   * Minimum entries required before clustering runs.
   * Avoids summaries with a single entry. Default: 3.
   */
  minClusterSize?: number;
  /**
   * Maximum summary length in characters. Default: 300.
   */
  maxSummaryLength?: number;
}

const DEFAULTS: Required<RaptorConfig> = {
  clusterSize: 5,
  minClusterSize: 3,
  maxSummaryLength: 300,
};

// ============================================================
// RaptorWorker
// ============================================================

/**
 * RaptorWorker — Stateless episodic cluster-and-summarise worker.
 *
 * Clustering uses a simple greedy binning approach (no embeddings required).
 * When embeddings ARE available, euclidean-distance binning groups semantically
 * similar entries. Without embeddings, entries are binned in arrival order.
 *
 * For production, replace `generateSummary()` with a real LLM call using
 * the `guidance-provider.ts` summarisation prompt.
 *
 * Source: arXiv:2401.18059 — RAPTOR recursive abstractive tree indexing.
 */
export class RaptorWorker {
  readonly name = 'raptor' as const;

  private readonly config: Required<RaptorConfig>;

  constructor(config: RaptorConfig = {}) {
    this.config = { ...DEFAULTS, ...config };
  }

  /**
   * Cluster episodic entries and generate summaries.
   *
   * @param entries  Raw episodic entries to summarise
   * @param namespace  Namespace for the generated summary entries
   */
  consolidate(entries: RaptorEntry[], namespace = 'consolidated'): RaptorResult {
    const start = Date.now();

    if (entries.length < this.config.minClusterSize) {
      return {
        clusters: [],
        totalEntries: entries.length,
        summaryEntries: [],
        durationMs: Date.now() - start,
      };
    }

    const clusters = this.clusterEntries(entries);
    const summaryEntries = clusters.map((cluster) => ({
      key: `raptor:summary:${namespace}:${cluster.clusterId}`,
      content: cluster.summary,
      namespace,
      memberIds: cluster.memberIds,
    }));

    return {
      clusters,
      totalEntries: entries.length,
      summaryEntries,
      durationMs: Date.now() - start,
    };
  }

  // ===================================================
  // Private helpers
  // ===================================================

  /**
   * Cluster entries into groups of approximately `clusterSize`.
   * If embeddings are present, uses nearest-centroid assignment.
   * Otherwise, bins sequentially.
   */
  private clusterEntries(entries: RaptorEntry[]): RaptorCluster[] {
    const hasEmbeddings = entries.every(e => e.embedding && e.embedding.length > 0);

    if (hasEmbeddings) {
      return this.embeddingClustering(entries);
    }

    return this.sequentialBinning(entries);
  }

  /** Simple sequential binning — no embedding required */
  private sequentialBinning(entries: RaptorEntry[]): RaptorCluster[] {
    const clusters: RaptorCluster[] = [];
    let clusterId = 0;

    for (let i = 0; i < entries.length; i += this.config.clusterSize) {
      const slice = entries.slice(i, i + this.config.clusterSize);
      if (slice.length < this.config.minClusterSize) {
        // Merge into previous cluster if too small
        if (clusters.length > 0) {
          const last = clusters[clusters.length - 1];
          last.memberIds.push(...slice.map(e => e.id));
          last.summary = this.generateSummary(
            [...last.memberIds.map((id) => entries.find(e => e.id === id)?.content ?? ''), ...slice.map(e => e.content)],
            last.clusterId,
          );
        }
        continue;
      }

      clusters.push({
        clusterId: clusterId++,
        memberIds: slice.map(e => e.id),
        summary: this.generateSummary(slice.map(e => e.content), clusterId - 1),
        tier: 'contextual',
      });
    }

    return clusters;
  }

  /** Greedy nearest-centroid clustering with sequential seeding */
  private embeddingClustering(entries: RaptorEntry[]): RaptorCluster[] {
    const k = Math.max(1, Math.ceil(entries.length / this.config.clusterSize));
    const dims = entries[0].embedding!.length;

    // Seed centroids evenly
    const centroids: number[][] = Array.from({ length: k }, (_, ci) => {
      const seedIdx = Math.floor((ci / k) * entries.length);
      return [...entries[seedIdx].embedding!];
    });

    // Assign each entry to nearest centroid
    const assignments: number[] = entries.map((entry) => {
      let nearest = 0;
      let nearestDist = Infinity;
      for (let ci = 0; ci < centroids.length; ci++) {
        const dist = this.euclidean(entry.embedding!, centroids[ci]);
        if (dist < nearestDist) { nearestDist = dist; nearest = ci; }
      }
      return nearest;
    });

    // Build clusters
    const clusterMap = new Map<number, RaptorEntry[]>();
    entries.forEach((entry, idx) => {
      const ci = assignments[idx];
      if (!clusterMap.has(ci)) clusterMap.set(ci, []);
      clusterMap.get(ci)!.push(entry);
    });

    return Array.from(clusterMap.entries())
      .filter(([, members]) => members.length >= this.config.minClusterSize)
      .map(([ci, members]) => ({
        clusterId: ci,
        memberIds: members.map(e => e.id),
        centroid: centroids[ci],
        summary: this.generateSummary(members.map(e => e.content), ci),
        tier: 'contextual' as const,
      }));
  }

  /**
   * Generate a cluster summary from member content strings.
   * In production, replace with an LLM call (e.g. guidance-provider.ts).
   */
  private generateSummary(contents: string[], clusterId: number): string {
    const words = new Map<string, number>();

    for (const text of contents) {
      for (const word of text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)) {
        if (word.length > 3 && !STOPWORDS.has(word)) {
          words.set(word, (words.get(word) ?? 0) + 1);
        }
      }
    }

    const topTerms = [...words.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w]) => w);

    const firstSentence = contents[0]?.slice(0, 120) ?? '';
    const themeStr = topTerms.length > 0 ? `Key themes: ${topTerms.join(', ')}.` : '';

    return `[Cluster ${clusterId} — ${contents.length} entries] ${firstSentence}… ${themeStr}`
      .slice(0, this.config.maxSummaryLength);
  }

  private euclidean(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      sum += d * d;
    }
    return Math.sqrt(sum);
  }
}

// ============================================================
// Stopwords for extractive summarisation
// ============================================================

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'been', 'will', 'they',
  'what', 'when', 'were', 'your', 'also', 'into', 'then', 'than',
  'some', 'more', 'each', 'such', 'like', 'very', 'just', 'over',
]);
