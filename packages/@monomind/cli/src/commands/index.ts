/**
 * CLI Commands Index
 * Central registry for all CLI commands
 */

import type { Command } from '../types.js';

const loadedCommands = new Map<string, Command>();

// =============================================================================
// Command Imports
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
import { doctorCommand } from './doctor.js';
import { performanceCommand } from './performance.js';
import { securityCommand } from './security.js';
import browseCommand from './browse.js';
import { configCommand } from './config.js';
import { completionsCommand } from './completions.js';
import { analyzeCommand } from './analyze.js';
import { routeCommand } from './route.js';
import { providersCommand } from './providers.js';
import updateCommand from './update.js';
import { guidanceCommand } from './guidance.js';
import { cleanupCommand } from './cleanup.js';
import { autopilotCommand } from './autopilot.js';
import { monographCommand } from './monograph.js';
import tokensCommand from './tokens.js';
import { platformsCommand } from './platforms.js';
import { designCommand } from './design-detect.js';
import { searchUniversalCommand } from './search-universal.js';
import { reportCrashCommand } from './report-crash.js';
import { crashReportingCommand } from './crash-reporting.js';
import { docCommand } from './doc.js';
import { orgCommand } from './org.js';

// Populate command cache
loadedCommands.set('init', initCommand);
loadedCommands.set('start', startCommand);
loadedCommands.set('status', statusCommand);
loadedCommands.set('task', taskCommand);
loadedCommands.set('session', sessionCommand);
loadedCommands.set('agent', agentCommand);
loadedCommands.set('swarm', swarmCommand);
loadedCommands.set('memory', memoryCommand);
loadedCommands.set('mcp', mcpCommand);
loadedCommands.set('hooks', hooksCommand);
loadedCommands.set('doctor', doctorCommand);
loadedCommands.set('performance', performanceCommand);
loadedCommands.set('security', securityCommand);
loadedCommands.set('guidance', guidanceCommand);
loadedCommands.set('cleanup', cleanupCommand);
loadedCommands.set('autopilot', autopilotCommand);
loadedCommands.set('monograph', monographCommand);
loadedCommands.set('tokens', tokensCommand);
loadedCommands.set('platforms', platformsCommand);
loadedCommands.set('browse', browseCommand);
loadedCommands.set('config', configCommand);
loadedCommands.set('completions', completionsCommand);
loadedCommands.set('analyze', analyzeCommand);
loadedCommands.set('route', routeCommand);
loadedCommands.set('providers', providersCommand);
loadedCommands.set('update', updateCommand);
loadedCommands.set('design', designCommand);
loadedCommands.set('search', searchUniversalCommand);
loadedCommands.set('report-crash', reportCrashCommand);
loadedCommands.set('crash-reporting', crashReportingCommand);
loadedCommands.set('doc', docCommand);
loadedCommands.set('org', orgCommand);

// =============================================================================
// Exports
// =============================================================================
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
export { doctorCommand } from './doctor.js';
export { performanceCommand } from './performance.js';
export { securityCommand } from './security.js';
export { guidanceCommand } from './guidance.js';
export { cleanupCommand } from './cleanup.js';
export { autopilotCommand } from './autopilot.js';
export { monographCommand } from './monograph.js';
export { platformsCommand } from './platforms.js';
export { designCommand } from './design-detect.js';
export { searchUniversalCommand } from './search-universal.js';
export { reportCrashCommand } from './report-crash.js';
export { crashReportingCommand } from './crash-reporting.js';
export { docCommand } from './doc.js';

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
  doctorCommand,
  performanceCommand,
  securityCommand,
  guidanceCommand,
  cleanupCommand,
  autopilotCommand,
  monographCommand,
  platformsCommand,
  designCommand,
  searchUniversalCommand,
  docCommand,
  crashReportingCommand,
  browseCommand,
  configCommand,
  completionsCommand,
  analyzeCommand,
  routeCommand,
  providersCommand,
  updateCommand,
  tokensCommand,
  reportCrashCommand,
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
    docCommand,
    taskCommand,
    sessionCommand,
    mcpCommand,
    hooksCommand,
  ],
  advanced: [
    securityCommand,
    performanceCommand,
    guidanceCommand,
    autopilotCommand,
  ],
  utility: [
    configCommand,
    doctorCommand,
      completionsCommand,
  ],
  analysis: [
    analyzeCommand,
    routeCommand,
    monographCommand,
    tokensCommand,
    searchUniversalCommand,
  ],
  management: [
    providersCommand,
    updateCommand,
    cleanupCommand,
    platformsCommand,
    browseCommand,
  ],
};

/**
 * Command registry map for quick lookup
 */
export const commandRegistry = new Map<string, Command>();

// Register core commands and their aliases
for (const cmd of commands) {
  commandRegistry.set(cmd.name, cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) {
      commandRegistry.set(alias, cmd);
    }
  }
}

export function getCommand(name: string): Command | undefined {
  return loadedCommands.get(name) || commandRegistry.get(name);
}

export async function getCommandAsync(name: string): Promise<Command | undefined> {
  return loadedCommands.get(name) || commandRegistry.get(name);
}

export function hasCommand(name: string): boolean {
  return loadedCommands.has(name) || commandRegistry.has(name);
}

export function getCommandNames(): string[] {
  const names = new Set([
    ...Array.from(commandRegistry.keys()),
    ...Array.from(loadedCommands.keys()),
  ]);
  return Array.from(names);
}

export function getUniqueCommands(): Command[] {
  return commands.filter(cmd => !cmd.hidden);
}

export async function loadAllCommands(): Promise<Command[]> {
  return [...commands];
}

/**
 * Setup commands in a CLI instance
 */
export function setupCommands(cli: { command: (cmd: Command) => void }): void {
  for (const cmd of commands) {
    cli.command(cmd);
  }
}

/**
 * Setup all commands (async variant)
 */
export async function setupAllCommands(cli: { command: (cmd: Command) => void }): Promise<void> {
  const allCommands = await loadAllCommands();
  for (const cmd of allCommands) {
    cli.command(cmd);
  }
}
