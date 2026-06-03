/**
 * Shared math utilities — single source of truth for the memory package.
 */

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const len = a.length;
  let dot = 0, normA = 0, normB = 0;
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
