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
