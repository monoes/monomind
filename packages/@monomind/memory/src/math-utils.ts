/**
 * Shared math utilities — single source of truth for the memory package.
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
 * Cosine similarity in [-1, 1]. Returns 0 for empty or zero-norm vectors, and
 * for vectors of different lengths (with a one-time warning).
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    warnVectorLengthMismatch(a.length, b.length);
    return 0;
  }
  if (a.length === 0) return 0;
  const len = a.length;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function createHashEmbedding(text: string, dim = 64): Float32Array {
  const embedding = new Float32Array(dim);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const idx = (code * (i + 1)) % dim;
    embedding[idx] += Math.sin(code * 0.1) * 0.1;
    embedding[(idx + 1) % dim] += Math.cos(code * 0.1) * 0.05;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += embedding[i] * embedding[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) embedding[i] /= norm;
  return embedding;
}
