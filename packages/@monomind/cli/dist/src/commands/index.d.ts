/**
 * CLI Commands Index
 * Central registry for all CLI commands
 *
 * NOTE: All commands are synchronously imported at module load time (lines below).
 * The commandLoaders/loadCommand infrastructure provides an async fallback for
 * commands looked up via getCommandAsync() but does NOT reduce startup time since
 * all modules are already imported synchronously for the commands array and
 * commandsByCategory exports.
 */
import type { Command } from '../types.js';
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
export { neuralCommand } from './neural.js';
export { performanceCommand } from './performance.js';
export { securityCommand } from './security.js';
export { monovectorCommand } from './monovector/index.js';
export { hiveMindCommand } from './hive-mind.js';
export { guidanceCommand } from './guidance.js';
export { cleanupCommand } from './cleanup.js';
export { autopilotCommand } from './autopilot.js';
export { monographCommand } from './monograph.js';
export { platformsCommand } from './platforms.js';
export { designCommand } from './design-detect.js';
export declare function getConfigCommand(): Promise<Command | undefined>;
export declare function getMigrateCommand(): Promise<Command | undefined>;
export declare function getWorkflowCommand(): Promise<Command | undefined>;
export declare function getHiveMindCommand(): Promise<Command | undefined>;
export declare function getProcessCommand(): Promise<Command | undefined>;
export declare function getTaskCommand(): Promise<Command | undefined>;
export declare function getSessionCommand(): Promise<Command | undefined>;
export declare function getNeuralCommand(): Promise<Command | undefined>;
export declare function getSecurityCommand(): Promise<Command | undefined>;
export declare function getPerformanceCommand(): Promise<Command | undefined>;
export declare function getProvidersCommand(): Promise<Command | undefined>;
export declare function getDeploymentCommand(): Promise<Command | undefined>;
export declare function getClaimsCommand(): Promise<Command | undefined>;
export declare function getCompletionsCommand(): Promise<Command | undefined>;
export declare function getAnalyzeCommand(): Promise<Command | undefined>;
export declare function getRouteCommand(): Promise<Command | undefined>;
export declare function getProgressCommand(): Promise<Command | undefined>;
export declare function getIssuesCommand(): Promise<Command | undefined>;
export declare function getMonovectorCommand(): Promise<Command | undefined>;
export declare function getGuidanceCommand(): Promise<Command | undefined>;
export declare function getCleanupCommand(): Promise<Command | undefined>;
export declare function getAutopilotCommand(): Promise<Command | undefined>;
export declare function getMonographCommand(): Promise<Command | undefined>;
/**
 * Core commands loaded synchronously (available immediately)
 * Advanced commands loaded on-demand for faster startup
 */
export declare const commands: Command[];
/**
 * Commands organized by category for help display
 */
export declare const commandsByCategory: {
    primary: Command[];
    advanced: Command[];
    utility: Command[];
    analysis: Command[];
    management: Command[];
};
/**
 * Command registry map for quick lookup
 * Supports both sync (core commands) and async (lazy-loaded) commands
 */
export declare const commandRegistry: Map<string, Command>;
/**
 * Get command by name (sync for core commands, returns undefined for lazy commands)
 * Use getCommandAsync for lazy-loaded commands
 */
export declare function getCommand(name: string): Command | undefined;
/**
 * Get command by name (async - supports lazy loading)
 */
export declare function getCommandAsync(name: string): Promise<Command | undefined>;
/**
 * Check if command exists (sync check for core commands)
 */
export declare function hasCommand(name: string): boolean;
/**
 * Get all command names (including aliases and lazy-loadable)
 */
export declare function getCommandNames(): string[];
/**
 * Get all unique commands (excluding aliases)
 */
export declare function getUniqueCommands(): Command[];
/**
 * Load all commands (populates lazy-loaded commands)
 * Use this when you need all commands available synchronously
 */
export declare function loadAllCommands(): Promise<Command[]>;
/**
 * Setup commands in a CLI instance
 */
export declare function setupCommands(cli: {
    command: (cmd: Command) => void;
}): void;
/**
 * Setup all commands including lazy-loaded (async)
 */
export declare function setupAllCommands(cli: {
    command: (cmd: Command) => void;
}): Promise<void>;
//# sourceMappingURL=index.d.ts.map