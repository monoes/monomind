// Distance metric: defaults to cosine similarity (cosineSimilarity function below).
// Configurable via the `metric` constructor parameter: 'cosine' (default), 'dot', 'euclidean'.
// Compatible with learning-service.mjs HNSWIndex which uses cosine similarity exclusively
// via _cosineSimilarity() in _searchGraph() (distance = 1 - cosineSimilarity).
// Both return higher-is-better scores in [0, 1] for cosine; HnswLite search() returns
// { id, score } where score = similarity (not distance), matching HNSWIndex's
// { patternId, similarity } shape.
// Verified: 2026-05-17

export interface HnswSearchResult {
  id: string;
  score: number;
}

export class HnswLite {
  vectors = new Map<string, Float32Array>();
  neighbors = new Map<string, Set<string>>();
  tombstones = new Set<string>();
  private readonly dimensions: number;
  private readonly maxNeighbors: number;
  private readonly efConstruction: number;
  private readonly metric: string;
  // Maintained entry point — updated on add/rebuild so search avoids an O(n) scan
  private entryPoint: string | undefined;

  constructor(dimensions: number, m: number, efConstruction: number, metric: string) {
    this.dimensions = dimensions;
    this.maxNeighbors = m;
    this.efConstruction = efConstruction;
    this.metric = metric;
  }

  get size(): number {
    return this.vectors.size - this.tombstones.size;
  }

  get tombstoneCount(): number {
    return this.tombstones.size;
  }

  add(id: string, vector: Float32Array): void {
    if (vector.length !== this.dimensions) {
      throw new RangeError(`Vector dimension mismatch: expected ${this.dimensions}, got ${vector.length}`);
    }
    this.vectors.set(id, vector);

    if (this.vectors.size === 1) {
      this.neighbors.set(id, new Set());
      this.entryPoint = id;
      return;
    }

    const nearest = this.findNearest(vector, this.maxNeighbors);
    const neighborSet = new Set<string>();

    for (const n of nearest) {
      neighborSet.add(n.id);
      const nNeighbors = this.neighbors.get(n.id);
      if (nNeighbors) {
        nNeighbors.add(id);
        if (nNeighbors.size > this.maxNeighbors * 2) {
          this.pruneNeighbors(n.id);
        }
      }
    }

    this.neighbors.set(id, neighborSet);
  }

  remove(id: string): void {
    this.tombstones.add(id);
    // Rebuild if dead-node ratio exceeds 12%
    if (this.vectors.size > 0 && this.tombstones.size / this.vectors.size > 0.12) {
      this._rebuildIndex();
    }
  }

  private _rebuildIndex(): void {
    for (const id of this.tombstones) {
      this.vectors.delete(id);
      const myNeighbors = this.neighbors.get(id);
      if (myNeighbors) {
        for (const nId of myNeighbors) {
          this.neighbors.get(nId)?.delete(id);
        }
      }
      this.neighbors.delete(id);
    }
    this.tombstones.clear();
    // Re-anchor entry point to a live node after pruning
    if (this.entryPoint === undefined || !this.vectors.has(this.entryPoint)) {
      this.entryPoint = this.vectors.keys().next().value;
    }
  }

  search(query: Float32Array, k: number, threshold?: number): HnswSearchResult[] {
    if (this.vectors.size === 0) return [];
    if (this.vectors.size <= k * 2) {
      return this.bruteForce(query, k, threshold);
    }

    const visited = new Set<string>();
    const candidates: HnswSearchResult[] = [];

    // Use the maintained entry point (O(1)), falling back to a linear scan only if
    // the stored entry point has been tombstoned since the last rebuild.
    let entryId: string | undefined = this.entryPoint && !this.tombstones.has(this.entryPoint)
      ? this.entryPoint
      : undefined;

    if (!entryId) {
      // Fallback: pick the first live node and update entryPoint
      for (const [id] of this.vectors) {
        if (!this.tombstones.has(id)) { entryId = id; break; }
      }
      this.entryPoint = entryId;
    }

    if (entryId) {
      // Include the entry point itself in the candidate set — it may be the closest node
      const entryVec = this.vectors.get(entryId);
      if (entryVec) {
        const entryScore = this.similarity(query, entryVec);
        candidates.push({ id: entryId, score: entryScore });
        visited.add(entryId);
      }

      const queue = [entryId];
      let idx = 0;

      while (idx < queue.length && visited.size < this.efConstruction * 2) {
        const currentId = queue[idx++];
        const currentNeighbors = this.neighbors.get(currentId);
        if (!currentNeighbors) continue;

        for (const nId of currentNeighbors) {
          if (visited.has(nId)) continue;
          if (this.tombstones.has(nId)) continue;
          visited.add(nId);

          const vec = this.vectors.get(nId);
          if (!vec) continue;

          const score = this.similarity(query, vec);
          candidates.push({ id: nId, score });
          queue.push(nId);
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    let filtered = candidates;
    if (threshold !== undefined) {
      filtered = filtered.filter(c => c.score >= threshold);
    }

    return filtered.slice(0, k);
  }

  private bruteForce(query: Float32Array, k: number, threshold?: number): HnswSearchResult[] {
    const results: HnswSearchResult[] = [];
    for (const [id, vec] of this.vectors) {
      if (this.tombstones.has(id)) continue;
      const score = this.similarity(query, vec);
      if (threshold !== undefined && score < threshold) continue;
      results.push({ id, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  private findNearest(query: Float32Array, k: number): HnswSearchResult[] {
    return this.bruteForce(query, k);
  }

  private pruneNeighbors(id: string): void {
    const myNeighbors = this.neighbors.get(id);
    if (!myNeighbors) return;

    const vec = this.vectors.get(id);
    if (!vec) return;

    const scored: HnswSearchResult[] = [];
    for (const nId of myNeighbors) {
      const nVec = this.vectors.get(nId);
      if (!nVec) continue;
      scored.push({ id: nId, score: this.similarity(vec, nVec) });
    }

    scored.sort((a, b) => b.score - a.score);
    const keep = new Set(scored.slice(0, this.maxNeighbors).map(s => s.id));

    for (const nId of myNeighbors) {
      if (!keep.has(nId)) {
        myNeighbors.delete(nId);
      }
    }
  }

  serialize(): object {
    return {
      dimensions: this.dimensions,
      maxNeighbors: this.maxNeighbors,
      efConstruction: this.efConstruction,
      metric: this.metric,
      entryPoint: this.entryPoint,
      vectors: Array.from(this.vectors.entries()).map(([id, vec]) => [id, Array.from(vec)]),
      neighbors: Array.from(this.neighbors.entries()).map(([id, nbrs]) => [id, Array.from(nbrs)]),
      tombstones: Array.from(this.tombstones),
    };
  }

  static deserialize(data: ReturnType<HnswLite['serialize']>): HnswLite {
    const index = new HnswLite(
      (data as any).dimensions,
      (data as any).maxNeighbors,
      (data as any).efConstruction,
      (data as any).metric ?? 'cosine'
    );
    index.vectors = new Map(
      ((data as any).vectors as [string, number[]][]).map(([id, vec]) => [id, new Float32Array(vec)])
    );
    index.neighbors = new Map(
      ((data as any).neighbors as [string, string[]][]).map(([id, nbrs]) => [id, new Set(nbrs)])
    );
    index.tombstones = new Set((data as any).tombstones ?? []);
    index.entryPoint = (data as any).entryPoint ?? index.vectors.keys().next().value;
    return index;
  }

  private similarity(a: Float32Array, b: Float32Array): number {
    if (this.metric === 'dot') return dotProduct(a, b);
    if (this.metric === 'euclidean') return 1 / (1 + euclideanDistance(a, b));
    return cosineSimilarity(a, b);
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
