/**
 * Init subcommands: check, skills, hooks
 */
import { output } from '../output.js';
import * as fs from 'fs';
import * as path from 'path';
import { executeInit, DEFAULT_INIT_OPTIONS, MINIMAL_INIT_OPTIONS, } from '../init/index.js';
function isInitialized(cwd) {
    const claudePath = path.join(cwd, '.claude', 'settings.json');
    const monomindPath = path.join(cwd, '.monomind', 'config.yaml');
    return {
        claude: fs.existsSync(claudePath),
        monomind: fs.existsSync(monomindPath),
    };
}
export const checkCommand = {
    name: 'check',
    description: 'Check if MonoMind is initialized',
    action: async (ctx) => {
        const initialized = isInitialized(ctx.cwd);
        const result = {
            initialized: initialized.claude || initialized.monomind,
            claude: initialized.claude,
            monomind: initialized.monomind,
            paths: {
                claudeSettings: initialized.claude ? path.join(ctx.cwd, '.claude', 'settings.json') : null,
                monomindConfig: initialized.monomind ? path.join(ctx.cwd, '.monomind', 'config.yaml') : null,
            },
        };
        if (ctx.flags.format === 'json') {
            output.printJson(result);
            return { success: true, data: result };
        }
        if (result.initialized) {
            output.printSuccess('MonoMind is initialized');
            if (initialized.claude) {
                output.printInfo(`  Claude Code: .claude/settings.json`);
            }
            if (initialized.monomind) {
                output.printInfo(`  Runtime: .monomind/config.yaml`);
            }
        }
        else {
            output.printWarning('MonoMind is not initialized in this directory');
            output.printInfo('Run "monomind init" to initialize');
        }
        return { success: true, data: result };
    },
};
export const skillsCommand = {
    name: 'skills',
    description: 'Initialize only skills',
    options: [
        { name: 'all', description: 'Install all skills', type: 'boolean', default: false },
        { name: 'core', description: 'Install core skills', type: 'boolean', default: true },
        { name: 'memory', description: 'Install memory skills', type: 'boolean', default: false },
        { name: 'github', description: 'Install GitHub skills', type: 'boolean', default: false },
    ],
    action: async (ctx) => {
        const options = {
            ...MINIMAL_INIT_OPTIONS,
            targetDir: ctx.cwd,
            force: ctx.flags.force,
            components: {
                settings: false,
                skills: true,
                commands: false,
                agents: false,
                helpers: false,
                statusline: false,
                mcp: false,
                runtime: false,
                claudeMd: false,
                graphify: false,
            },
            skills: {
                all: ctx.flags.all,
                core: ctx.flags.core,
                memory: ctx.flags.memory,
                github: ctx.flags.github,
                browser: false,
                advanced: false,
            },
        };
        const spinner = output.createSpinner({ text: 'Installing skills...' });
        spinner.start();
        const result = await executeInit(options);
        if (result.success) {
            spinner.succeed(`Installed ${result.summary.skillsCount} skills`);
        }
        else {
            spinner.fail('Failed to install skills');
            for (const error of result.errors) {
                output.printError(error);
            }
        }
        return { success: result.success, data: result };
    },
};
export const hooksCommand = {
    name: 'hooks',
    description: 'Initialize only hooks configuration',
    options: [
        { name: 'all', description: 'Enable all hooks', type: 'boolean', default: true },
        { name: 'minimal', description: 'Enable only essential hooks', type: 'boolean', default: false },
    ],
    action: async (ctx) => {
        const minimal = ctx.flags.minimal;
        const options = {
            ...DEFAULT_INIT_OPTIONS,
            targetDir: ctx.cwd,
            force: ctx.flags.force,
            components: {
                settings: true,
                skills: false,
                commands: false,
                agents: false,
                helpers: false,
                statusline: false,
                mcp: false,
                runtime: false,
                claudeMd: false,
                graphify: false,
            },
            hooks: minimal
                ? {
                    preToolUse: true,
                    postToolUse: true,
                    userPromptSubmit: false,
                    sessionStart: false,
                    stop: false,
                    preCompact: false,
                    notification: false,
                    teammateIdle: false,
                    taskCompleted: false,
                    timeout: 5000,
                    continueOnError: true,
                }
                : DEFAULT_INIT_OPTIONS.hooks,
        };
        const spinner = output.createSpinner({ text: 'Creating hooks configuration...' });
        spinner.start();
        const result = await executeInit(options);
        if (result.success) {
            spinner.succeed(`Created settings.json with ${result.summary.hooksEnabled} hooks enabled`);
        }
        else {
            spinner.fail('Failed to create hooks configuration');
            for (const error of result.errors) {
                output.printError(error);
            }
        }
        return { success: result.success, data: result };
    },
};
//# sourceMappingURL=init-subcommands.js.map