/**
 * Dynamic Agent Synthesis — Task 47
 *
 * On-demand agent synthesis when no existing agent matches
 * above the HNSW similarity threshold.
 *
 * @packageDocumentation
 */

// Types
export type {
  AgentDefinition,
  AgentCapability,
  SynthesisRequest,
  EphemeralAgentRecord,
  CleanupResult,
} from './types.js';

// Schema & prompt template
export {
  agentDefinitionSchema,
  SynthesisPromptTemplate,
} from './synthesis-prompt-template.js';

// Ephemeral registry
export { EphemeralRegistry } from './ephemeral-registry.js';

// TTL cleanup
export { TTLCleanup } from './ttl-cleanup.js';

// Agent promotion + DGM MAP-Elites archive (source: arXiv:2505.22954)
export {
  AgentPromoter,
  DGMArchive,
  type DGMArchiveEntry,
} from './agent-promoter.js';
