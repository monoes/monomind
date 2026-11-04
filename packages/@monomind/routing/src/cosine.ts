/** Shared across every monomind cosine copy so the process warns at most once. */
const LENGTH_MISMATCH_WARNED = Symbol.for('monomind.cosine.lengthMismatchWarned');

/**
 * Warn, at most once per process, that two vectors of different lengths were
 * compared. That usually means the embedding model changed under a stored index.
 */
function warnVectorLengthMismatch(a: number, b: number): void {
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
 * Returns a value in [-1, 1], where 1 = identical direction. Returns 0 for
 * empty or zero-norm vectors, and for vectors of different lengths (with a
 * one-time warning, see warnVectorLengthMismatch).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    warnVectorLengthMismatch(a.length, b.length);
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/**
 * Compute the mean centroid of a list of vectors.
 * All vectors must have the same dimensionality.
 */
export function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) throw new Error('Cannot compute centroid of empty array');
  const dim = vectors[0].length;
  const centroid = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    centroid[i] /= vectors.length;
  }
  return centroid;
}
