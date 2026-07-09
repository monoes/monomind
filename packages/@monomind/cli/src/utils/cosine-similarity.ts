/**
 * Shared cosine similarity utility.
 *
 * Previously duplicated in 5 independent implementations:
 *   - memory/intelligence.ts (ReasoningBank.cosineSim)
 *   - mcp-tools/neural-tools.ts (cosineSimilarity)
 *   - mcp-tools/embeddings-tools.ts (cosineSimilarity)
 *   - mcp-tools/coherence/types.ts (cosineSimilarity)
 *   - mcp-tools/coherence/coherence-check.ts (cosineSimilarity)
 *
 * This is the single canonical implementation. Accepts number[] or
 * Float32Array. Handles dimension mismatches gracefully (uses the shorter
 * length) and returns 0 for zero-magnitude vectors.
 */

/**
 * Compute cosine similarity between two vectors.
 *
 * Returns a value in [-1, 1]. Returns 0 when either vector is empty or
 * has zero magnitude.
 */
export function cosineSimilarity(
  a: number[] | Float32Array,
  b: number[] | Float32Array,
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;

  const len = Math.min(a.length, b.length);
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
