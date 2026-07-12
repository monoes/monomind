/**
 * CLI Start Command
 * System startup for Monomind orchestration
 */
import { output } from '../output.js';
import { confirm } from '../prompt.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
/** Check liveness of a pid via a zero-signal, matching the pattern used elsewhere (e.g. .claude/helpers/control-start.cjs). */
function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
// Default configuration
const DEFAULT_TOPOLOGY = 'hierarchical-mesh';
const DEFAULT_MAX_AGENTS = 15;
// Check if project is initialized
function isInitialized(cwd) {
    const configPath = path.join(cwd, '.monomind', 'config.yaml');
    return fs.existsSync(configPath);
}
// Simple YAML parser for config (basic implementation)
function parseSimpleYaml(content) {
    const result = {};
    const lines = content.split('\n');
    const stack = [
        { indent: -1, obj: result }
    ];
    for (const line of lines) {
        // Skip comments and empty lines
        if (line.trim().startsWith('#') || line.trim() === '')
            continue;
        const match = line.match(/^(\s*)(\w+):\s*(.*)$/);
        if (!match)
            continue;
        const indent = match[1].length;
        const key = match[2];
        let value = match[3].trim();
        // Parse value
        if (value === '' || value === undefined) {
            value = {};
        }
        else if (value === 'true') {
            value = true;
        }
        else if (value === 'false') {
            value = false;
        }
        else if (value === 'null') {
            value = null;
        }
        else if (!isNaN(Number(value)) && value !== '') {
            value = Number(value);
        }
        else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        // Find parent based on indentation
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        const parent = stack[stack.length - 1].obj;
        if (typeof value === 'object' && value !== null) {
            parent[key] = value;
            stack.push({ indent, obj: value, key });
        }
        else {
            parent[key] = value;
        }
    }
    return result;
}
// Load configuration
function loadConfig(cwd) {
    const configPath = path.join(cwd, '.monomind', 'config.yaml');
    if (!fs.existsSync(configPath))
        return null;
    if (fs.statSync(configPath).size > 1024 * 1024)
        return null; // skip files > 1 MB
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        return parseSimpleYaml(content);
    }
    catch {
        return null;
    }
}
// Main start action
const startAction = async (ctx) => {
    const daemon = ctx.flags.daemon;
    const topology = ctx.flags.topology;
    const cwd = ctx.cwd;
    // Check initialization
    if (!isInitialized(cwd)) {
        output.printError('MonoMind is not initialized in this directory');
        output.printInfo('Run "monomind init" first to initialize');
        return { success: false, exitCode: 1 };
    }
    // Daemon mode, parent side: a Node process cannot truly self-daemonize —
    // every handle (streams, intervals) would need to be unref'd, which leaves
    // nothing keeping the event loop alive and the process exits almost
    // immediately. Instead, spawn a genuine DETACHED CHILD process that
    // re-invokes this same command with an internal marker flag; the parent's
    // only job is to confirm the child came up and then exit. The child (see
    // the `--foreground-worker-internal` branch below) is the one that actually
    // stays running, with a real ref'd keep-alive.
    const isDaemonChild = Boolean(ctx.flags['foreground-worker-internal']);
    if (daemon && !isDaemonChild) {
        output.writeln();
        output.writeln(output.bold('Starting Monomind (daemon)'));
        output.writeln();
        const daemonPidPath = path.join(cwd, '.monomind', 'daemon.pid');
        if (fs.existsSync(daemonPidPath)) {
            const stalePid = Number(fs.readFileSync(daemonPidPath, 'utf-8').trim());
            if (isPidAlive(stalePid)) {
                output.printError(`Daemon already running (pid ${stalePid}). Run "monomind stop" first.`);
                return { success: false, exitCode: 1 };
            }
            // Stale pid file — the prior daemon is dead, safe to remove.
            fs.unlinkSync(daemonPidPath);
        }
        // Reconstruct the child's argv explicitly rather than reusing process.argv —
        // startAction can be reached via `start`, `start quick`, or `restart`
        // (which calls startAction directly in-process), so process.argv may not
        // even contain the `start` subcommand. Building the args from ctx.flags
        // guarantees the respawned child always dispatches to a valid daemon start.
        const entry = process.argv[1];
        const childArgs = ['start', '--daemon', '--foreground-worker-internal'];
        if (topology)
            childArgs.push('--topology', topology);
        const child = spawn(process.execPath, [entry, ...childArgs], {
            detached: true,
            stdio: 'ignore',
            cwd,
        });
        child.unref();
        // Give the child a moment to actually start before trusting its pid.
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!child.pid || !isPidAlive(child.pid)) {
            output.printError('Daemon child process failed to start');
            return { success: false, exitCode: 1 };
        }
        fs.mkdirSync(path.dirname(daemonPidPath), { recursive: true });
        fs.writeFileSync(daemonPidPath, String(child.pid), { mode: 0o600 });
        output.printSuccess(`Monomind daemon started (pid ${child.pid})`);
        output.printInfo('Use "monomind stop" to stop it.');
        const daemonStartResult = { daemon: true, pid: child.pid, startedAt: new Date().toISOString() };
        if (ctx.flags.format === 'json') {
            output.printJson(daemonStartResult);
        }
        return { success: true, data: daemonStartResult };
    }
    // Load configuration
    const config = loadConfig(cwd);
    const swarmConfig = config?.swarm || {};
    const VALID_TOPOLOGIES = new Set(['hierarchical-mesh', 'mesh', 'hierarchical', 'ring', 'star']);
    const rawTopology = topology || swarmConfig.topology || DEFAULT_TOPOLOGY;
    const finalTopology = VALID_TOPOLOGIES.has(rawTopology) ? rawTopology : DEFAULT_TOPOLOGY;
    const rawMaxAgents = Number(swarmConfig.maxAgents || DEFAULT_MAX_AGENTS);
    const maxAgents = Number.isFinite(rawMaxAgents) ? Math.max(1, Math.min(rawMaxAgents, 100)) : DEFAULT_MAX_AGENTS;
    output.writeln();
    output.writeln(output.bold('Starting Monomind'));
    output.writeln();
    const spinner = output.createSpinner({ text: 'Initializing system...' });
    try {
        // Step 1: Initialize swarm
        spinner.start();
        spinner.setText('Initializing v1 swarm...');
        const swarmResult = await callMCPTool('swarm_init', {
            topology: finalTopology,
            maxAgents,
            autoScaling: swarmConfig.autoScale !== false,
            v1Mode: true
        });
        spinner.succeed(`Swarm initialized (${finalTopology})`);
        // Step 2: Run health check
        spinner.setText('Running health checks...');
        spinner.start();
        const healthResult = await callMCPTool('swarm_health', {
            swarmId: swarmResult.swarmId
        });
        if (healthResult.status === 'healthy') {
            spinner.succeed('Health checks passed');
        }
        else {
            spinner.fail(`Health check: ${healthResult.status}`);
        }
        // Success output
        output.writeln();
        output.printSuccess('Monomind is running!');
        output.writeln();
        // Status display
        output.printBox([
            `Swarm ID:  ${swarmResult.swarmId}`,
            `Topology:  ${finalTopology}`,
            `Max Agents: ${maxAgents}`,
            `Mode:      ${daemon ? 'Daemon' : 'Foreground'}`,
            `Health:    ${healthResult.status}`
        ].join('\n'), 'System Status');
        output.writeln();
        output.writeln(output.bold('Quick Commands:'));
        output.printList([
            `${output.highlight('monomind status')} - View system status`,
            `${output.highlight('monomind agent spawn -t coder')} - Spawn an agent`,
            `${output.highlight('monomind swarm status')} - View swarm details`,
            `${output.highlight('monomind stop')} - Stop the system`
        ]);
        // Daemon mode: this branch only runs inside the detached child spawned by
        // the parent-side block above (isDaemonChild === true — the parent never
        // reaches here, it already returned after confirming the child is alive).
        // The pid file was already written by the parent with the CHILD's pid, so
        // just confirm it's in place and start the real, ref'd keep-alive that
        // actually holds the event loop open.
        if (daemon && isDaemonChild) {
            output.writeln();
            output.printInfo('Running in daemon mode. Use "monomind stop" to stop.');
            const daemonPidPath = path.join(cwd, '.monomind', 'daemon.pid');
            // Keep the process alive with a REAL (ref'd) interval — this is what
            // actually keeps Node's event loop from exiting, since stdio was
            // already set to 'ignore' by the parent's spawn() call.
            const keepAlive = setInterval(() => {
                // Heartbeat - exit if our pid file has been removed (e.g. by `stop`)
                if (!fs.existsSync(daemonPidPath)) {
                    clearInterval(keepAlive);
                    process.exit(0);
                }
            }, 5000);
            // Deliberately NOT unref'd — this is the one handle that must keep the
            // daemon child's event loop alive indefinitely.
        }
        const result = {
            swarmId: swarmResult.swarmId,
            topology: finalTopology,
            maxAgents,
            health: healthResult.status,
            daemon,
            startedAt: new Date().toISOString()
        };
        if (ctx.flags.format === 'json') {
            output.printJson(result);
        }
        return { success: true, data: result };
    }
    catch (error) {
        spinner.fail('Startup failed');
        if (error instanceof MCPClientError) {
            output.printError(`Failed to start: ${error.message}`);
        }
        else {
            output.printError(`Unexpected error: ${String(error)}`);
        }
        return { success: false, exitCode: 1 };
    }
};
// Stop subcommand
const stopCommand = {
    name: 'stop',
    description: 'Stop the MonoMind system',
    options: [
        {
            name: 'force',
            short: 'f',
            description: 'Force stop without graceful shutdown',
            type: 'boolean',
            default: false
        },
        {
            name: 'timeout',
            description: 'Shutdown timeout in seconds',
            type: 'number',
            default: 30
        }
    ],
    action: async (ctx) => {
        const force = ctx.flags.force;
        const rawTimeout = ctx.flags.timeout;
        const timeout = Number.isFinite(rawTimeout) ? Math.max(1, Math.min(rawTimeout, 300)) : 30;
        output.writeln();
        output.writeln(output.bold('Stopping MonoMind'));
        output.writeln();
        if (!force && ctx.interactive) {
            const confirmed = await confirm({
                message: 'Are you sure you want to stop MonoMind?',
                default: false
            });
            if (!confirmed) {
                output.printInfo('Operation cancelled');
                return { success: true };
            }
        }
        const spinner = output.createSpinner({ text: 'Stopping system...' });
        spinner.start();
        try {
            // Stop swarm
            spinner.setText('Stopping swarm...');
            spinner.start();
            try {
                await callMCPTool('swarm_shutdown', {
                    graceful: !force,
                    timeout,
                    saveState: true
                });
                spinner.succeed('Swarm stopped');
            }
            catch {
                spinner.fail('Swarm was not running');
            }
            // Stop the daemon process itself: read its real pid, verify liveness,
            // send a real termination signal, then wait and confirm it's actually
            // dead before reporting success — rather than unconditionally deleting
            // the pid file and claiming success regardless of reality.
            const daemonPidPath = path.join(ctx.cwd, '.monomind', 'daemon.pid');
            let daemonWasRunning = false;
            let daemonStopped = true;
            let daemonPid = null;
            if (fs.existsSync(daemonPidPath)) {
                const pidStr = fs.readFileSync(daemonPidPath, 'utf-8').trim();
                const pid = Number(pidStr);
                daemonPid = Number.isInteger(pid) && pid > 0 ? pid : null;
                if (daemonPid && isPidAlive(daemonPid)) {
                    daemonWasRunning = true;
                    spinner.setText(`Stopping daemon (pid ${daemonPid})...`);
                    spinner.start();
                    try {
                        process.kill(daemonPid, force ? 'SIGKILL' : 'SIGTERM');
                    }
                    catch {
                        // Process may have exited between the liveness check and the signal
                    }
                    // Wait and confirm the process actually exited before claiming success.
                    const waitMs = Math.min(timeout, 10) * 1000;
                    const deadline = Date.now() + waitMs;
                    while (Date.now() < deadline && isPidAlive(daemonPid)) {
                        await new Promise((resolve) => setTimeout(resolve, 200));
                    }
                    if (isPidAlive(daemonPid) && force) {
                        try {
                            process.kill(daemonPid, 'SIGKILL');
                        }
                        catch { /* already gone */ }
                        await new Promise((resolve) => setTimeout(resolve, 300));
                    }
                    daemonStopped = !isPidAlive(daemonPid);
                    if (daemonStopped) {
                        spinner.succeed(`Daemon stopped (pid ${daemonPid})`);
                    }
                    else {
                        spinner.fail(`Daemon (pid ${daemonPid}) did not stop within ${waitMs}ms`);
                    }
                }
                // Only clean up the pid file once we've confirmed the process is gone
                // (or it was already stale) — never delete it while a live daemon
                // still owns it.
                if (daemonStopped) {
                    fs.unlinkSync(daemonPidPath);
                }
            }
            output.writeln();
            if (!daemonWasRunning) {
                output.printInfo('No daemon was running.');
            }
            else if (daemonStopped) {
                output.printSuccess(`MonoMind daemon stopped successfully (pid ${daemonPid})`);
            }
            else {
                output.printError(`Failed to stop daemon (pid ${daemonPid}) — it did not exit in time`);
                return {
                    success: false,
                    exitCode: 1,
                    data: { stopped: false, force, pid: daemonPid }
                };
            }
            return {
                success: true,
                data: { stopped: daemonWasRunning ? daemonStopped : null, force, pid: daemonPid, stoppedAt: new Date().toISOString() }
            };
        }
        catch (error) {
            spinner.fail('Stop failed');
            output.printError(`Failed to stop: ${error instanceof Error ? error.message : String(error)}`);
            return { success: false, exitCode: 1 };
        }
    }
};
// Restart subcommand
const restartCommand = {
    name: 'restart',
    description: 'Restart the MonoMind system',
    options: [
        {
            name: 'force',
            short: 'f',
            description: 'Force restart',
            type: 'boolean',
            default: false
        }
    ],
    action: async (ctx) => {
        output.writeln();
        output.writeln(output.bold('Restarting MonoMind'));
        output.writeln();
        // Stop first
        const stopCtx = { ...ctx, flags: { ...ctx.flags } };
        const stopResult = await stopCommand.action(stopCtx);
        if (stopResult && !stopResult.success) {
            output.printWarning('Stop failed, attempting to start anyway...');
        }
        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Start again
        const startResult = await startAction(ctx);
        return {
            success: startResult.success,
            data: {
                restarted: startResult.success,
                restartedAt: new Date().toISOString()
            }
        };
    }
};
// Quick start subcommand
const quickCommand = {
    name: 'quick',
    aliases: ['q'],
    description: 'Quick start with default settings',
    action: async (ctx) => {
        // Initialize if needed
        if (!isInitialized(ctx.cwd)) {
            output.printInfo('Project not initialized, running init first...');
            output.writeln();
            // Call init with minimal settings
            const { initCommand } = await import('./init.js');
            const initCtx = {
                ...ctx,
                flags: { ...ctx.flags, minimal: true }
            };
            await initCommand.action(initCtx);
            output.writeln();
        }
        // Start with defaults
        return startAction({
            ...ctx,
            flags: { ...ctx.flags, topology: 'mesh' }
        });
    }
};
// Main start command
export const startCommand = {
    name: 'start',
    description: 'Start the MonoMind orchestration system',
    subcommands: [stopCommand, restartCommand, quickCommand],
    options: [
        {
            name: 'daemon',
            short: 'd',
            description: 'Run as daemon in background',
            type: 'boolean',
            default: false
        },
        {
            name: 'topology',
            short: 't',
            description: 'Swarm topology (hierarchical-mesh, mesh, hierarchical, ring, star)',
            type: 'string',
            choices: ['hierarchical-mesh', 'mesh', 'hierarchical', 'ring', 'star']
        }
    ],
    examples: [
        { command: 'monomind start', description: 'Start with configuration defaults' },
        { command: 'monomind start --daemon', description: 'Start as background daemon' },
        { command: 'monomind start --topology mesh', description: 'Start with mesh topology' },
        { command: 'monomind start quick', description: 'Quick start with defaults' },
        { command: 'monomind start stop', description: 'Stop the running system' }
    ],
    action: startAction
};
export default startCommand;
//# sourceMappingURL=start.js.map