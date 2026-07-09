import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { output } from '../output.js';
const buildSubcommand = {
    name: 'build',
    description: 'AI-powered: open a URL, analyze DOM, generate an action JSON file',
    options: [
        { name: 'url', short: 'u', type: 'string', description: 'URL to analyze', required: true },
        { name: 'task', short: 't', type: 'string', description: 'What you want the action to do', required: true },
        { name: 'port', type: 'number', description: 'CDP port', default: 9222 },
        { name: 'output', short: 'o', type: 'string', description: 'Output directory', default: '.monomind/actions' },
    ],
    action: async (ctx) => {
        const url = ctx.flags.url;
        const task = ctx.flags.task;
        const port = ctx.flags.port ?? 9222;
        const outDir = join(ctx.cwd, ctx.flags.output ?? '.monomind/actions');
        if (!url || !task) {
            output.printError('--url and --task are required');
            return { success: false, exitCode: 1 };
        }
        const { isClaudeCodeAvailable } = await import('../routing/llm-caller.js');
        if (!isClaudeCodeAvailable()) {
            output.printError('Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
            return { success: false, exitCode: 1 };
        }
        const spinner = output.createSpinner({ text: `Opening ${url}...`, spinner: 'dots' });
        spinner.start();
        try {
            const browser = await import('@monoes/monobrowse');
            const cdpPort = await browser.launchBrowser({ port, headless: false });
            const { client, sessionId } = await browser.connectToTarget(cdpPort);
            spinner.stop('Navigated. Analyzing DOM...');
            const { analyzeAndBuild } = await import('../browser/action-builder/analyzer.js');
            const action = await analyzeAndBuild({ url, task, client, sessionId, outputDir: outDir });
            spinner.succeed(`Action generated: ${action.id}`);
            output.writeln();
            output.printBox([
                `ID: ${action.id}`,
                `Platform: ${action.platform}`,
                `Steps: ${action.steps.length}`,
                `Params: ${action.params.join(', ')}`,
                `Saved to: ${outDir}/${action.id.replace(/[^a-z0-9_-]/gi, '_')}.json`,
            ].join('\n'), 'Action Built');
            client.close();
            return { success: true, data: action };
        }
        catch (err) {
            spinner.fail('Action build failed');
            output.printError(err.message);
            return { success: false, exitCode: 1 };
        }
    },
};
const listSubcommand = {
    name: 'list',
    aliases: ['ls'],
    description: 'List available actions (built-in + custom)',
    action: async (ctx) => {
        const customDir = join(ctx.cwd, '.monomind', 'actions');
        let customFiles = [];
        try {
            customFiles = (await readdir(customDir)).filter(f => f.endsWith('.json'));
        }
        catch { }
        const builtinActions = [
            { id: 'linkedin:comment_post', platform: 'linkedin', name: 'Comment on Post', source: 'built-in' },
            { id: 'linkedin:like_post', platform: 'linkedin', name: 'Like Post', source: 'built-in' },
            { id: 'linkedin:send_connection', platform: 'linkedin', name: 'Send Connection Request', source: 'built-in' },
            { id: 'linkedin:publish_post', platform: 'linkedin', name: 'Publish Post', source: 'built-in' },
            { id: 'instagram:like_post', platform: 'instagram', name: 'Like Post', source: 'built-in' },
            { id: 'instagram:comment_post', platform: 'instagram', name: 'Comment on Post', source: 'built-in' },
            { id: 'instagram:follow_user', platform: 'instagram', name: 'Follow User', source: 'built-in' },
            { id: 'x:like_post', platform: 'x', name: 'Like Post', source: 'built-in' },
            { id: 'x:reply_post', platform: 'x', name: 'Reply to Post', source: 'built-in' },
            { id: 'x:follow_user', platform: 'x', name: 'Follow User', source: 'built-in' },
            { id: 'gemini:submit_prompt', platform: 'gemini', name: 'Submit Prompt', source: 'built-in' },
        ];
        const customActions = await Promise.all(customFiles.map(async (f) => {
            try {
                const raw = await readFile(join(customDir, f), 'utf8');
                const def = JSON.parse(raw);
                return { id: def.id, platform: def.platform ?? 'custom', name: def.name, source: 'custom' };
            }
            catch {
                return null;
            }
        }));
        const all = [...builtinActions, ...customActions.filter(Boolean)];
        output.printTable({
            columns: [
                { key: 'id', header: 'Action ID', width: 30 },
                { key: 'platform', header: 'Platform', width: 12 },
                { key: 'name', header: 'Name', width: 25 },
                { key: 'source', header: 'Source', width: 10 },
            ],
            data: all,
        });
        return { success: true };
    },
};
const showSubcommand = {
    name: 'show',
    description: 'Print an action definition JSON',
    action: async (ctx) => {
        const actionId = ctx.args[0];
        if (!actionId) {
            output.printError('Action ID required');
            return { success: false, exitCode: 1 };
        }
        const customDir = join(ctx.cwd, '.monomind', 'actions');
        const filename = actionId.replace(/[^a-z0-9_-]/gi, '_') + '.json';
        try {
            const raw = await readFile(join(customDir, filename), 'utf8');
            output.printJson(JSON.parse(raw));
            return { success: true };
        }
        catch {
            output.printError(`Action not found: ${actionId}. Check "monomind browse action list".`);
            return { success: false, exitCode: 1 };
        }
    },
};
const runSubcommand = {
    name: 'run',
    description: 'Run a single action directly',
    options: [
        { name: 'account', short: 'a', type: 'string', description: 'Platform account username' },
        { name: 'params', short: 'p', type: 'array', description: 'Params as key=value pairs' },
        { name: 'port', type: 'number', description: 'CDP port', default: 9222 },
    ],
    action: async (ctx) => {
        const actionId = ctx.args[0];
        if (!actionId) {
            output.printError('Action ID required. Usage: monomind browse action run <action-id>');
            return { success: false, exitCode: 1 };
        }
        const port = ctx.flags.port ?? 9222;
        const paramsRaw = ctx.flags.params ?? [];
        const params = {};
        for (const pair of paramsRaw) {
            const eq = pair.indexOf('=');
            if (eq > 0)
                params[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
        const customDir = join(ctx.cwd, '.monomind', 'actions');
        const filename = actionId.replace(/[^a-z0-9_-]/gi, '_') + '.json';
        let def;
        try {
            def = JSON.parse(await readFile(join(customDir, filename), 'utf8'));
        }
        catch {
            output.printError(`Action not found: ${actionId}. Run "monomind browse action list" to see available actions.`);
            return { success: false, exitCode: 1 };
        }
        output.printInfo(`Running action: ${def.id} (${def.steps.length} steps)`);
        try {
            const { connectToTarget, openUrl, clickElement, fillElement, evaluateJs, findBySelector, waitFor } = await import('@monoes/monobrowse');
            const { client, sessionId } = await connectToTarget(port);
            const refs = new Map();
            const interpolate = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] ?? `{{${k}}}`);
            for (const step of def.steps) {
                switch (step.type) {
                    case 'navigate':
                        await openUrl(client, sessionId, interpolate(step.url));
                        output.writeln(output.dim(`  navigate -> ${step.url}`));
                        break;
                    case 'find':
                        for (const sel of step.selectors ?? []) {
                            const found = await findBySelector(client, sessionId, refs, interpolate(sel)).catch(() => null);
                            if (found) {
                                refs.set(step.as, found);
                                break;
                            }
                        }
                        output.writeln(output.dim(`  find -> ${step.as}`));
                        break;
                    case 'click': {
                        const ref = refs.get(step.target);
                        if (!ref)
                            throw new Error(`Element "${step.target}" not found`);
                        await clickElement(client, sessionId, ref);
                        output.writeln(output.dim(`  click -> ${step.target}`));
                        break;
                    }
                    case 'type': {
                        const ref = refs.get(step.target);
                        if (!ref)
                            throw new Error(`Element "${step.target}" not found`);
                        await fillElement(client, sessionId, ref, interpolate(step.text));
                        output.writeln(output.dim(`  type -> ${step.target}`));
                        break;
                    }
                    case 'wait':
                        if (step.condition === 'network_idle')
                            await waitFor(client, sessionId, { load: 'networkidle', timeout: step.timeout });
                        else if (step.condition === 'selector')
                            await waitFor(client, sessionId, { selector: step.selector, timeout: step.timeout });
                        else if (step.condition === 'duration')
                            await new Promise(r => setTimeout(r, step.timeout ?? 1000));
                        output.writeln(output.dim(`  wait -> ${step.condition}`));
                        break;
                    case 'extract': {
                        const ref = refs.get(step.target);
                        if (!ref)
                            throw new Error(`Element "${step.target}" not found`);
                        const val = await evaluateJs(client, sessionId, `document.querySelector('[data-ref="${ref.ref}"]')?.textContent`);
                        output.writeln(output.dim(`  extract -> ${step.as}: ${val}`));
                        break;
                    }
                    case 'condition': {
                        const result = await evaluateJs(client, sessionId, step.expression);
                        if (result) {
                            output.writeln(output.dim('  condition -> true branch'));
                        }
                        break;
                    }
                }
            }
            output.printSuccess(`Action ${def.id} completed successfully.`);
            return { success: true };
        }
        catch (err) {
            output.printError(`Action failed: ${err.message}`);
            return { success: false, exitCode: 1 };
        }
    },
};
export const browseActionCommand = {
    name: 'action',
    description: 'Manage and run browser actions',
    subcommands: [buildSubcommand, runSubcommand, listSubcommand, showSubcommand],
    action: async () => {
        output.writeln(output.bold('browse action — usage:'));
        output.printList([
            'monomind browse action build --url <url> --task "description"',
            'monomind browse action list',
            'monomind browse action show <action-id>',
        ]);
        return { success: true };
    },
};
export default browseActionCommand;
//# sourceMappingURL=browse-action.js.map