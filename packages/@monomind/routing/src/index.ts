export { buildCandidateHints, buildCapabilityIndex } from './capability-index.js';
export { computeCentroid, cosineSimilarity } from './cosine.js';
export type { Encoder } from './encoder.js';
export { HNSWEncoder, LocalEncoder } from './encoder.js';
export type { KeywordRule } from './keyword-pre-filter.js';
export { DEFAULT_KEYWORD_ROUTES, KeywordPreFilter } from './keyword-pre-filter.js';
export { LLMFallbackRouter } from './llm-fallback.js';
export { buildClassificationPrompt } from './prompts/classify.js';
export { RouteLayer } from './route-layer.js';
export { ALL_ROUTES } from './routes/index.js';
export type {
  AgentCapability,
  LLMFallbackConfig,
  Route,
  RouteLayerConfig,
  RouteResult,
} from './types.js';
