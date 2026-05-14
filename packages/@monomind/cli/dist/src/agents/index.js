/**
 * Agent utilities — prompt versioning, experiment routing, managed agents.
 *
 * @module @monoes/cli/agents
 */
export { PromptExperimentRouter } from './prompt-experiment.js';
export { PromptVersionManager } from './prompt-version-manager.js';
export { spawnAndAwait } from './managed-agent.js';
export { check as checkTermination, persistEvent } from './termination-watcher.js';
export { broadcast as broadcastHalt, isHalted } from './halt-signal.js';
export { buildRegistry } from './registry-builder.js';
export { RegistryQuery } from './registry-query.js';
//# sourceMappingURL=index.js.map