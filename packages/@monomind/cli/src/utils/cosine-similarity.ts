/**
 * Shared cosine similarity utility.
 *
 * Previously duplicated in 5 independent implementations:
 *   - memory/intelligence.ts (ReasoningBank.cosineSim)
 *   - mcp-tools/neural-tools.ts (cosineSimilarity)
 *   - mcp-tools/embeddings-tools.ts (cosineSimilarity)
 *   - mcp-tools/coherence/types.ts + coherence-check.ts (both since deleted
 *     along with the rest of the uncalled coherence_* family)
 *
 * This is the single canonical implementation. Accepts number[] or typed
 * arrays. Returns 0 for empty, zero-magnitude and mismatched-length vectors.
 */

/** Shared across every monomind cosine copy so the process warns at most once. */
const LENGTH_MISMATCH_WARNED = Symbol.for('monomind.cosine.lengthMismatchWarned');

/**
 * Warn, at most once per process, that two vectors of different lengths were
 * compared. That usually means the embedding model changed under a stored index.
 */
export function warnVectorLengthMismatch(a: number, b: number): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[LENGTH_MISMATCH_WARNED]) return;
  g[LENGTH_MISMATCH_WARNED] = true;
  console.warn(
    `[monomind] cosine similarity: vector length mismatch (${a} vs ${b}), scored as 0. ` +
      'The embedding model probably changed under a stored index; rebuild it.',
  );
}

/**
 * Compute cosine similarity between two vectors.
 *
 * Returns a value in [-1, 1]. Returns 0 when either vector is empty or
 * has zero magnitude, and when the lengths differ (with a one-time warning).
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b) return 0;
  if (a.length !== b.length) {
    warnVectorLengthMismatch(a.length, b.length);
    return 0;
  }
  if (a.length === 0) return 0;

  const len = a.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const mag = Math.sqrt(normA) * Math.sqrt(normB);
  return mag === 0 ? 0 : dot / mag;
}
