/**
 * CLI Commands Index
 * Central registry for all CLI commands
 */
const loadedCommands = new Map();
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
import { daemonCommand } from './daemon.js';
import { doctorCommand } from './doctor.js';
import { performanceCommand } from './performance.js';
import { securityCommand } from './security.js';
import { hiveMindCommand } from './hive-mind.js';
import browseCommand from './browse.js';
import { configCommand } from './config.js';
import { completionsCommand } from './completions.js';
import { workflowCommand } from './workflow.js';
import { analyzeCommand } from './analyze.js';
import { routeCommand } from './route.js';
import { providersCommand } from './providers.js';
import { claimsCommand } from './claims.js';
import { issuesCommand } from './issues.js';
import updateCommand from './update.js';
import { processCommand } from './process.js';
import { guidanceCommand } from './guidance.js';
import { cleanupCommand } from './cleanup.js';
import { autopilotCommand } from './autopilot.js';
import { monographCommand } from './monograph.js';
import replayCommand from './replay.js';
import storeCommand from './transfer-store.js';
import tokensCommand from './tokens.js';
import { platformsCommand } from './platforms.js';
import { designCommand } from './design-detect.js';
import { enrichCommand } from './enrich.js';
import { searchUniversalCommand } from './search-universal.js';
import { scanCommand } from './scan.js';
import { reportCrashCommand } from './report-crash.js';
import { crashReportingCommand } from './crash-reporting.js';
import { docCommand } from './doc.js';
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
loadedCommands.set('daemon', daemonCommand);
loadedCommands.set('doctor', doctorCommand);
loadedCommands.set('performance', performanceCommand);
loadedCommands.set('security', securityCommand);
loadedCommands.set('hive-mind', hiveMindCommand);
loadedCommands.set('guidance', guidanceCommand);
loadedCommands.set('cleanup', cleanupCommand);
loadedCommands.set('autopilot', autopilotCommand);
loadedCommands.set('monograph', monographCommand);
loadedCommands.set('replay', replayCommand);
loadedCommands.set('transfer-store', storeCommand);
loadedCommands.set('tokens', tokensCommand);
loadedCommands.set('platforms', platformsCommand);
loadedCommands.set('browse', browseCommand);
loadedCommands.set('config', configCommand);
loadedCommands.set('completions', completionsCommand);
loadedCommands.set('workflow', workflowCommand);
loadedCommands.set('analyze', analyzeCommand);
loadedCommands.set('route', routeCommand);
loadedCommands.set('providers', providersCommand);
loadedCommands.set('claims', claimsCommand);
loadedCommands.set('issues', issuesCommand);
loadedCommands.set('update', updateCommand);
loadedCommands.set('process', processCommand);
loadedCommands.set('design', designCommand);
loadedCommands.set('enrich', enrichCommand);
loadedCommands.set('search', searchUniversalCommand);
loadedCommands.set('scan', scanCommand);
loadedCommands.set('report-crash', reportCrashCommand);
loadedCommands.set('crash-reporting', crashReportingCommand);
loadedCommands.set('doc', docCommand);
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
export { daemonCommand } from './daemon.js';
export { doctorCommand } from './doctor.js';
export { performanceCommand } from './performance.js';
export { securityCommand } from './security.js';
export { hiveMindCommand } from './hive-mind.js';
export { guidanceCommand } from './guidance.js';
export { cleanupCommand } from './cleanup.js';
export { autopilotCommand } from './autopilot.js';
export { monographCommand } from './monograph.js';
export { platformsCommand } from './platforms.js';
export { designCommand } from './design-detect.js';
export { enrichCommand } from './enrich.js';
export { searchUniversalCommand } from './search-universal.js';
export { scanCommand } from './scan.js';
export { reportCrashCommand } from './report-crash.js';
export { crashReportingCommand } from './crash-reporting.js';
export { docCommand } from './doc.js';
/**
 * All registered commands
 */
export const commands = [
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
    performanceCommand,
    securityCommand,
    hiveMindCommand,
    guidanceCommand,
    cleanupCommand,
    autopilotCommand,
    monographCommand,
    platformsCommand,
    designCommand,
    enrichCommand,
    searchUniversalCommand,
    scanCommand,
    docCommand,
    crashReportingCommand,
    browseCommand,
    configCommand,
    completionsCommand,
    workflowCommand,
    analyzeCommand,
    routeCommand,
    providersCommand,
    claimsCommand,
    issuesCommand,
    updateCommand,
    processCommand,
    replayCommand,
    storeCommand,
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
        hiveMindCommand,
        guidanceCommand,
        autopilotCommand,
    ],
    utility: [
        configCommand,
        doctorCommand,
        daemonCommand,
        completionsCommand,
        workflowCommand,
    ],
    analysis: [
        analyzeCommand,
        routeCommand,
        monographCommand,
        replayCommand,
        tokensCommand,
        enrichCommand,
        searchUniversalCommand,
        scanCommand,
    ],
    management: [
        providersCommand,
        claimsCommand,
        issuesCommand,
        updateCommand,
        processCommand,
        storeCommand,
        cleanupCommand,
        platformsCommand,
        browseCommand,
    ],
};
/**
 * Command registry map for quick lookup
 */
export const commandRegistry = new Map();
// Register core commands and their aliases
for (const cmd of commands) {
    commandRegistry.set(cmd.name, cmd);
    if (cmd.aliases) {
        for (const alias of cmd.aliases) {
            commandRegistry.set(alias, cmd);
        }
    }
}
export function getCommand(name) {
    return loadedCommands.get(name) || commandRegistry.get(name);
}
export async function getCommandAsync(name) {
    return loadedCommands.get(name) || commandRegistry.get(name);
}
export function hasCommand(name) {
    return loadedCommands.has(name) || commandRegistry.has(name);
}
export function getCommandNames() {
    const names = new Set([
        ...Array.from(commandRegistry.keys()),
        ...Array.from(loadedCommands.keys()),
    ]);
    return Array.from(names);
}
export function getUniqueCommands() {
    return commands.filter(cmd => !cmd.hidden);
}
export async function loadAllCommands() {
    return [...commands];
}
/**
 * Setup commands in a CLI instance
 */
export function setupCommands(cli) {
    for (const cmd of commands) {
        cli.command(cmd);
    }
}
/**
 * Setup all commands (async variant)
 */
export async function setupAllCommands(cli) {
    const allCommands = await loadAllCommands();
    for (const cmd of allCommands) {
        cli.command(cmd);
    }
}
//# sourceMappingURL=index.js.map