/**
 * Shared dimensional constants for the neural / SONA layer.
 * These are TWO DISTINCT concepts — do not conflate them.
 */

/** SONA transformer hidden width (model internal). The weight matrices are built for this. */
export const SONA_HIDDEN_DIM = 768;

/** Default embedding/data vector dimension (e.g. MiniLM-L6-v2 produces 384). */
export const DEFAULT_VECTOR_DIM = 384;

/** SONA edge-mode reduced dimension. */
export const SONA_EDGE_DIM = 384;

/** Max MicroLoRA rank — values >2 cause an uncatchable Rust SIGABRT in @monoes/sona. */
export const SONA_MICRO_LORA_RANK_MAX = 2;

/** Clamp a MicroLoRA rank into the safe 1..2 range. */
export function safeMicroLoraRank(rank: number): number {
  return Math.min(Math.max(1, Math.floor(rank) || 1), SONA_MICRO_LORA_RANK_MAX);
}
