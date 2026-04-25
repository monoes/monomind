/**
 * Compute cosine similarity between two vectors.
 * Returns a value in [-1, 1], where 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
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
