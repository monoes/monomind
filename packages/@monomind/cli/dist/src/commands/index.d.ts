/**
 * CLI Commands Index
 * Central registry for all CLI commands
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
 */
export declare const commandRegistry: Map<string, Command>;
export declare function getCommand(name: string): Command | undefined;
export declare function getCommandAsync(name: string): Promise<Command | undefined>;
export declare function hasCommand(name: string): boolean;
export declare function getCommandNames(): string[];
export declare function getUniqueCommands(): Command[];
export declare function loadAllCommands(): Promise<Command[]>;
/**
 * Setup commands in a CLI instance
 */
export declare function setupCommands(cli: {
    command: (cmd: Command) => void;
}): void;
/**
 * Setup all commands (async variant)
 */
export declare function setupAllCommands(cli: {
    command: (cmd: Command) => void;
}): Promise<void>;
//# sourceMappingURL=index.d.ts.map