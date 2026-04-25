/**
 * Agent utilities — prompt versioning, experiment routing, managed agents.
 *
 * @module @monobrain/cli/agents
 */

export { PromptExperimentRouter } from './prompt-experiment.js';
export type { ResolvedPrompt } from './prompt-experiment.js';

export { PromptVersionManager } from './prompt-version-manager.js';

export { spawnAndAwait } from './managed-agent.js';
export type { AgentRunResult, ManagedAgentOptions } from './managed-agent.js';

export { check as checkTermination, persistEvent } from './termination-watcher.js';
export type { AgentRunState } from './termination-watcher.js';

export { broadcast as broadcastHalt, isHalted } from './halt-signal.js';
export type { HaltRecord } from './halt-signal.js';

export { buildRegistry } from './registry-builder.js';
export { RegistryQuery } from './registry-query.js';
export type { RegistryValidationResult, RegistryConflict } from './registry-query.js';
