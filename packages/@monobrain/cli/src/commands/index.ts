/**
 * CLI Commands Index
 * Central registry for all CLI commands
 *
 * All commands are synchronously imported at module load time.
 * The commandRegistry map provides O(1) lookup by name or alias.
 */

import type { Command } from '../types.js';

// =============================================================================
// Synchronous Imports
// =============================================================================

import { initCommand } from './init.js';
import { startCommand } from './start.js';
import { statusCommand } from './status.js';
import { taskCommand } from './task.js';
import { sessionCommand } from './session.js';
import { agentCommand } from './agent.js';
import { swarmCommand } from './swarm.js';
import { memoryCommand } from './memory.js';
import { mcpCommand } from './mcp.js';
import { hooksCommand } from './hooks.js';
import { daemonCommand } from './daemon.js';
import { doctorCommand } from './doctor.js';
import { embeddingsCommand } from './embeddings.js';
import { neuralCommand } from './neural.js';
import { performanceCommand } from './performance.js';
import { securityCommand } from './security.js';
import { ruvectorCommand } from './ruvector/index.js';
import { hiveMindCommand } from './hive-mind.js';
// Additional commands for categorized help display
import { configCommand } from './config.js';
import { completionsCommand } from './completions.js';
import { migrateCommand } from './migrate.js';
import { workflowCommand } from './workflow.js';
import { analyzeCommand } from './analyze.js';
import { routeCommand } from './route.js';
import { providersCommand } from './providers.js';
import { pluginsCommand } from './plugins.js';
import { deploymentCommand } from './deployment.js';
import { claimsCommand } from './claims.js';
import updateCommand from './update.js';
import { guidanceCommand } from './guidance.js';
import { cleanupCommand } from './cleanup.js';
import { autopilotCommand } from './autopilot.js';
import { benchmarkCommand } from './benchmark.js';
import { tokensCommand } from './tokens.js';

// =============================================================================
// Exports
// =============================================================================

// Re-export individual commands for external consumers
export { initCommand } from './init.js';
export { startCommand } from './start.js';
export { statusCommand } from './status.js';
export { taskCommand } from './task.js';
export { sessionCommand } from './session.js';
export { agentCommand } from './agent.js';
export { swarmCommand } from './swarm.js';
export { memoryCommand } from './memory.js';
export { mcpCommand } from './mcp.js';
export { hooksCommand } from './hooks.js';
export { daemonCommand } from './daemon.js';
export { doctorCommand } from './doctor.js';
export { embeddingsCommand } from './embeddings.js';
export { neuralCommand } from './neural.js';
export { performanceCommand } from './performance.js';
export { securityCommand } from './security.js';
export { ruvectorCommand } from './ruvector/index.js';
export { hiveMindCommand } from './hive-mind.js';
export { guidanceCommand } from './guidance.js';
export { cleanupCommand } from './cleanup.js';
export { autopilotCommand } from './autopilot.js';

/**
 * All registered commands
 */
export const commands: Command[] = [
  initCommand,
  startCommand,
  statusCommand,
  taskCommand,
  sessionCommand,
  agentCommand,
  swarmCommand,
  memoryCommand,
  mcpCommand,
  hooksCommand,
  daemonCommand,
  doctorCommand,
  embeddingsCommand,
  neuralCommand,
  performanceCommand,
  securityCommand,
  ruvectorCommand,
  hiveMindCommand,
  guidanceCommand,
  cleanupCommand,
  autopilotCommand,
  benchmarkCommand,
  tokensCommand,
  configCommand,
  completionsCommand,
  migrateCommand,
  workflowCommand,
  analyzeCommand,
  routeCommand,
  providersCommand,
  pluginsCommand,
  deploymentCommand,
  claimsCommand,
  updateCommand,
];

/**
 * Commands organized by category for help display
 */
export const commandsByCategory = {
  primary: [
    initCommand,
    startCommand,
    statusCommand,
    agentCommand,
    swarmCommand,
    memoryCommand,
    taskCommand,
    sessionCommand,
    mcpCommand,
    hooksCommand,
  ],
  advanced: [
    neuralCommand,
    securityCommand,
    performanceCommand,
    embeddingsCommand,
    hiveMindCommand,
    ruvectorCommand,
    guidanceCommand,
    autopilotCommand,
  ],
  utility: [
    configCommand,
    doctorCommand,
    daemonCommand,
    completionsCommand,
    migrateCommand,
    workflowCommand,
  ],
  analysis: [
    analyzeCommand,
    routeCommand,
    benchmarkCommand,
    tokensCommand,
  ],
  management: [
    providersCommand,
    pluginsCommand,
    deploymentCommand,
    claimsCommand,
    updateCommand,
    cleanupCommand,
  ],
};

/**
 * Command registry map for quick lookup by name or alias
 */
export const commandRegistry = new Map<string, Command>();

// Register all commands and their aliases
for (const cmd of commands) {
  commandRegistry.set(cmd.name, cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) {
      commandRegistry.set(alias, cmd);
    }
  }
}

/**
 * Get command by name or alias
 */
export function getCommand(name: string): Command | undefined {
  return commandRegistry.get(name);
}

/**
 * Get command by name or alias (async for backwards compatibility)
 */
export async function getCommandAsync(name: string): Promise<Command | undefined> {
  return commandRegistry.get(name);
}

/**
 * Check if command exists by name or alias
 */
export function hasCommand(name: string): boolean {
  return commandRegistry.has(name);
}

/**
 * Get all command names (including aliases)
 */
export function getCommandNames(): string[] {
  return Array.from(commandRegistry.keys());
}
