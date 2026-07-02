/**
 * CLI Init Command
 * Comprehensive initialization for Monomind with Claude Code integration
 */
import { output } from '../output.js';
import { confirm } from '../prompt.js';
import * as fs from 'fs';
import * as path from 'path';
import { executeInit, DEFAULT_INIT_OPTIONS, MINIMAL_INIT_OPTIONS, FULL_INIT_OPTIONS, } from '../init/index.js';
import { wizardCommand } from './init-wizard.js';
import { upgradeCommand } from './init-upgrade.js';
import { checkCommand, skillsCommand, hooksCommand } from './init-subcommands.js';
function isInitialized(cwd) {
    const claudePath = path.join(cwd, '.claude', 'settings.json');
    const monomindPath = path.join(cwd, '.monomind', 'config.yaml');
    return {
        claude: fs.existsSync(claudePath),
        monomind: fs.existsSync(monomindPath),
    };
}
const initAction = async (ctx) => {
    const force = ctx.flags.force;
    const minimal = ctx.flags.minimal;
    const full = ctx.flags.full;
    const skipClaude = ctx.flags['skip-claude'];
    const onlyClaude = ctx.flags['only-claude'];
    const cwd = ctx.cwd;
    const initialized = isInitialized(cwd);
    const hasExisting = initialized.claude || initialized.monomind;
    if (hasExisting && !force) {
        output.printWarning('MonoMind appears to be already initialized');
        if (initialized.claude)
            output.printInfo('  Found: .claude/settings.json');
        if (initialized.monomind)
            output.printInfo('  Found: .monomind/config.yaml');
        output.printInfo('Use --force to reinitialize');
        const yes = ctx.flags.yes || process.env.CI === 'true';
        if (ctx.interactive && !yes) {
            const proceed = await confirm({
                message: 'Do you want to reinitialize? This will overwrite existing configuration.',
                default: false,
            });
            if (!proceed) {
                return { success: true, message: 'Initialization cancelled' };
            }
        }
        else if (!yes) {
            return { success: false, exitCode: 1, message: 'Already initialized. Use --force or --yes to reinitialize.' };
        }
    }
    output.writeln();
    output.writeln(output.bold('Initializing Monomind'));
    output.writeln();
    let options;
    if (minimal) {
        options = { ...MINIMAL_INIT_OPTIONS, targetDir: cwd, force };
    }
    else if (full) {
        options = { ...FULL_INIT_OPTIONS, targetDir: cwd, force };
    }
    else {
        options = { ...DEFAULT_INIT_OPTIONS, targetDir: cwd, force };
    }
    if (skipClaude) {
        options.components.settings = false;
        options.components.skills = false;
        options.components.commands = false;
        options.components.agents = false;
        options.components.helpers = false;
        options.components.statusline = false;
        options.components.mcp = false;
        options.components.claudeMd = false;
    }
    if (onlyClaude) {
        options.components.runtime = false;
    }
    const spinner = output.createSpinner({ text: 'Initializing...' });
    spinner.start();
    try {
        const result = await executeInit(options);
        if (!result.success) {
            spinner.fail('Initialization failed');
            for (const error of result.errors) {
                output.printError(error);
            }
            return { success: false, exitCode: 1 };
        }
        spinner.succeed('Monomind initialized successfully!');
        // Start monograph watch for ongoing file-change rebuilds, unless --no-watch was passed.
        // Guard: skip if a watcher PID file already exists and the process is still alive,
        // preventing duplicate watchers from accumulating on repeated `init --force` runs.
        const noWatch = ctx.flags['no-watch'];
        if (!noWatch) {
            try {
                const { spawn } = await import('child_process');
                const pidFile = path.join(ctx.cwd, '.monomind', 'monograph-watch.pid');
                let alreadyRunning = false;
                if (fs.existsSync(pidFile) && fs.statSync(pidFile).size <= 32) {
                    const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
                    if (!isNaN(existingPid)) {
                        try {
                            process.kill(existingPid, 0);
                            alreadyRunning = true;
                        }
                        catch { /* process gone */ }
                    }
                }
                if (!alreadyRunning) {
                    const logPath = path.join(ctx.cwd, '.monomind', 'monograph-watch.log');
                    const { openSync } = fs;
                    const logFd = openSync(logPath, 'a');
                    const proc = spawn(process.execPath, [process.argv[1], 'monograph', 'watch'], {
                        detached: true,
                        stdio: ['ignore', logFd, logFd],
                        cwd: ctx.cwd,
                        env: process.env,
                    });
                    fs.writeFileSync(pidFile, String(proc.pid));
                    proc.unref();
                    output.printInfo('◈ Knowledge graph watch started in background');
                }
                else {
                    output.printInfo('◈ Knowledge graph watch already running — skipping');
                }
            }
            catch {
                // non-critical
            }
        }
        output.writeln();
        const summary = [];
        if (result.created.directories.length > 0) {
            summary.push(`Directories: ${result.created.directories.length} created`);
        }
        if (result.created.files.length > 0) {
            summary.push(`Files: ${result.created.files.length} created`);
        }
        if (result.skipped.length > 0) {
            summary.push(`Skipped: ${result.skipped.length} (already exist)`);
        }
        output.printBox(summary.join('\n'), 'Summary');
        output.writeln();
        if (options.components.claudeMd || options.components.settings || options.components.skills || options.components.commands || options.components.agents) {
            output.printBox([
                options.components.claudeMd ? `CLAUDE.md:   Swarm guidance & configuration` : '',
                options.components.settings ? `Settings:    .claude/settings.json` : '',
                options.components.skills ? `Skills:      .claude/skills/ (${result.summary.skillsCount} skills)` : '',
                options.components.commands ? `Commands:    .claude/commands/ (${result.summary.commandsCount} commands)` : '',
                options.components.agents ? `Agents:      .claude/agents/ (${result.summary.agentsCount} agents)` : '',
                options.components.helpers ? `Helpers:     .claude/helpers/` : '',
                options.components.mcp ? `MCP:         .mcp.json` : '',
            ].filter(Boolean).join('\n'), 'Claude Code Integration');
            output.writeln();
        }
        if (options.components.runtime) {
            output.printBox([
                `Config:      .monomind/config.yaml`,
                `Data:        .monomind/data/`,
                `Logs:        .monomind/logs/`,
                `Sessions:    .monomind/sessions/`,
            ].join('\n'), 'v1 Runtime');
            output.writeln();
        }
        if (result.summary.hooksEnabled > 0) {
            output.printInfo(`Hooks: ${result.summary.hooksEnabled} hook types enabled in settings.json`);
            output.writeln();
        }
        const startAll = ctx.flags['start-all'] || ctx.flags.startAll;
        const startDaemon = ctx.flags['start-daemon'] || ctx.flags.startDaemon || startAll;
        if (startDaemon || startAll) {
            output.writeln();
            output.printInfo('Starting services...');
            const { execSync, spawn: spawnChild } = await import('child_process');
            if (startAll) {
                try {
                    output.writeln(output.dim('  Initializing memory database...'));
                    execSync('npx @monomind/cli@latest memory init', {
                        stdio: 'pipe',
                        cwd: ctx.cwd,
                        timeout: 30000
                    });
                    output.writeln(output.success('  ✓ Memory initialized'));
                }
                catch {
                    output.writeln(output.dim('  Memory database already exists'));
                }
            }
            if (startDaemon) {
                try {
                    output.writeln(output.dim('  Starting daemon...'));
                    const daemonProc = spawnChild(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['@monomind/cli@latest', 'daemon', 'start'], { stdio: 'ignore', detached: true, cwd: ctx.cwd });
                    daemonProc.unref();
                    output.writeln(output.success('  ✓ Daemon started'));
                }
                catch {
                    output.writeln(output.warning('  Daemon may already be running'));
                }
            }
            if (startAll) {
                try {
                    output.writeln(output.dim('  Initializing swarm...'));
                    execSync('npx @monomind/cli@latest swarm init --topology hierarchical', {
                        stdio: 'pipe',
                        cwd: ctx.cwd,
                        timeout: 30000
                    });
                    output.writeln(output.success('  ✓ Swarm initialized'));
                }
                catch {
                    output.writeln(output.dim('  Swarm initialization skipped'));
                }
            }
            output.writeln();
            output.printSuccess('All services started');
        }
        const withEmbeddings = ctx.flags['with-embeddings'] || ctx.flags.withEmbeddings;
        const embeddingModel = (ctx.flags['embedding-model'] || ctx.flags.embeddingModel || 'Xenova/all-MiniLM-L6-v2');
        if (withEmbeddings) {
            output.writeln();
            output.printInfo('Initializing ONNX embedding subsystem...');
            const ALLOWED_MODELS = /^[\w\-./]+$/;
            if (!ALLOWED_MODELS.test(embeddingModel)) {
                output.writeln(output.error('Invalid model identifier. Only alphanumeric characters, hyphens, dots, and slashes are allowed.'));
                return { success: false, exitCode: 1 };
            }
            const { execFileSync } = await import('child_process');
            try {
                output.writeln(output.dim(`  Model: ${embeddingModel}`));
                output.writeln(output.dim('  Hyperbolic: Enabled (Poincaré ball)'));
                execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['@monomind/cli@latest', 'embeddings', 'init', '--model', embeddingModel, '--no-download', '--force'], {
                    stdio: 'pipe',
                    cwd: ctx.cwd,
                    timeout: 30000
                });
                output.writeln(output.success('  ✓ Embeddings initialized'));
                output.writeln(output.dim('    Run "embeddings init --download" to download model'));
            }
            catch {
                output.writeln(output.warning('  Embedding initialization skipped (run manually)'));
            }
        }
        if (!startDaemon && !startAll) {
            output.writeln(output.bold('Next steps:'));
            output.printList([
                `Run ${output.highlight('monomind daemon start')} to start background workers`,
                `Run ${output.highlight('monomind memory init')} to initialize memory database`,
                `Run ${output.highlight('monomind swarm init')} to initialize a swarm`,
                `Or use ${output.highlight('monomind init --start-all')} to do all of the above`,
                options.components.settings ? `Review ${output.highlight('.claude/settings.json')} for hook configurations` : '',
            ].filter(Boolean));
        }
        output.writeln('');
        output.writeln(output.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        output.writeln(output.bold('  Run /mastermind:understand next'));
        output.writeln('');
        output.writeln('  In Claude Code, type:  /mastermind:understand');
        output.writeln('');
        output.writeln('  This analyzes your project with an LLM and enriches the');
        output.writeln('  knowledge graph with semantic summaries, tags, and layers.');
        output.writeln('  Claude Code will have a much richer mental model of your');
        output.writeln('  codebase from the very first session.');
        output.writeln(output.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        if (ctx.flags.format === 'json') {
            output.printJson(result);
        }
        return { success: true, data: result };
    }
    catch (error) {
        spinner.fail('Initialization failed');
        output.printError(`Failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
        return { success: false, exitCode: 1 };
    }
};
export const initCommand = {
    name: 'init',
    description: 'Initialize MonoMind in the current directory',
    subcommands: [wizardCommand, checkCommand, skillsCommand, hooksCommand, upgradeCommand],
    options: [
        {
            name: 'force',
            short: 'f',
            description: 'Overwrite existing configuration',
            type: 'boolean',
            default: false,
        },
        {
            name: 'yes',
            short: 'y',
            description: 'Skip confirmation prompts (also honoured via CI=true env var)',
            type: 'boolean',
            default: false,
        },
        {
            name: 'minimal',
            short: 'm',
            description: 'Create minimal configuration',
            type: 'boolean',
            default: false,
        },
        {
            name: 'full',
            description: 'Create full configuration with all components',
            type: 'boolean',
            default: false,
        },
        {
            name: 'skip-claude',
            description: 'Skip .claude/ directory creation (runtime only)',
            type: 'boolean',
            default: false,
        },
        {
            name: 'only-claude',
            description: 'Only create .claude/ directory (skip runtime)',
            type: 'boolean',
            default: false,
        },
        {
            name: 'start-all',
            description: 'Auto-start daemon, memory, and swarm after init',
            type: 'boolean',
            default: false,
        },
        {
            name: 'start-daemon',
            description: 'Auto-start daemon after init',
            type: 'boolean',
            default: false,
        },
        {
            name: 'no-watch',
            description: 'Skip starting the monograph knowledge graph watcher after init',
            type: 'boolean',
            default: false,
        },
        {
            name: 'with-embeddings',
            description: 'Initialize ONNX embedding subsystem with hyperbolic support',
            type: 'boolean',
            default: false,
        },
        {
            name: 'embedding-model',
            description: 'ONNX embedding model to use',
            type: 'string',
            default: 'Xenova/all-MiniLM-L6-v2',
            choices: ['Xenova/all-MiniLM-L6-v2', 'Xenova/all-mpnet-base-v2'],
        },
    ],
    examples: [
        { command: 'monomind init', description: 'Initialize with default configuration' },
        { command: 'monomind init --start-all', description: 'Initialize and start daemon, memory, swarm' },
        { command: 'monomind init --start-daemon', description: 'Initialize and start daemon only' },
        { command: 'monomind init --minimal', description: 'Initialize with minimal configuration' },
        { command: 'monomind init --full', description: 'Initialize with all components' },
        { command: 'monomind init --force', description: 'Reinitialize and overwrite existing config' },
        { command: 'monomind init --only-claude', description: 'Only create Claude Code integration' },
        { command: 'monomind init --skip-claude', description: 'Only create v1 runtime' },
        { command: 'monomind init wizard', description: 'Interactive setup wizard' },
        { command: 'monomind init --no-watch', description: 'Initialize without starting the background graph watcher' },
        { command: 'monomind init --with-embeddings', description: 'Initialize with ONNX embeddings' },
        { command: 'monomind init --with-embeddings --embedding-model Xenova/all-mpnet-base-v2', description: 'Use larger embedding model' },
        { command: 'monomind init skills --all', description: 'Install all available skills' },
        { command: 'monomind init hooks --minimal', description: 'Create minimal hooks configuration' },
        { command: 'monomind init upgrade', description: 'Update helpers while preserving data' },
        { command: 'monomind init upgrade --settings', description: 'Update helpers and merge new settings (Agent Teams)' },
        { command: 'monomind init upgrade --verbose', description: 'Show detailed upgrade info' },
    ],
    action: initAction,
};
export default initCommand;
//# sourceMappingURL=init.js.map