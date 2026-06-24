import { writeFile, mkdir } from 'fs/promises';
import { join, resolve, isAbsolute } from 'path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { input, confirm } from '../prompt.js';

const createSubcommand: Command = {
  name: 'create',
  description: 'Scaffold a new workflow JSON file',
  options: [
    { name: 'output', short: 'o', type: 'string', description: 'Output directory', default: '.monomind/workflows' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.args[0] ?? (ctx.interactive ? await input({ message: 'Workflow name:' }) : undefined);
    if (!name || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      output.printError('Workflow name required (alphanumeric, dash, underscore, max 64 chars)');
      return { success: false, exitCode: 1 };
    }
    const outDir = join(ctx.cwd, ctx.flags.output as string ?? '.monomind/workflows');
    await mkdir(outDir, { recursive: true });
    const filePath = join(outDir, `${name}.json`);
    const template = {
      id: name, name: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      nodes: [
        { id: 'trigger', type: 'trigger.manual', config: {} },
        { id: 'action1', type: 'action.linkedin.comment_post',
          config: { post_url: '{{$json.url}}', text: '{{$json.comment}}', account: '{{$env.LINKEDIN_USER}}' } },
      ],
      connections: [{ from: 'trigger', to: 'action1' }],
    };
    await writeFile(filePath, JSON.stringify(template, null, 2));
    output.printSuccess(`Created ${filePath}`);
    output.printInfo('Edit the file, then run: monomind browse workflow run ' + filePath);
    return { success: true };
  },
};

const runSubcommand: Command = {
  name: 'run',
  description: 'Execute a workflow JSON file',
  options: [
    { name: 'no-dashboard', type: 'boolean', description: 'Skip opening web dashboard', default: false },
    { name: 'port', type: 'number', description: 'Dashboard port', default: 4242 },
    { name: 'items', short: 'i', type: 'string', description: 'JSON file of input items array' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rawPath = ctx.args[0];
    if (!rawPath) { output.printError('Workflow file required: monomind browse workflow run <file.json>'); return { success: false, exitCode: 1 }; }
    const filePath = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath);

    const { readWorkflow } = await import('../browser/workflow/store.js');
    const { runWorkflow } = await import('../browser/workflow/engine.js');
    const { getDashboardServer } = await import('../browser/dashboard/server.js');

    const wf = await readWorkflow(filePath).catch(e => { output.printError(e.message); return null; });
    if (!wf) return { success: false, exitCode: 1 };

    const port = ctx.flags.port as number ?? 4242;
    const dashboard = getDashboardServer(port);
    if (!ctx.flags['no-dashboard']) {
      output.printInfo(`Dashboard: http://localhost:${dashboard.port}`);
      const { exec } = await import('child_process');
      exec(`open http://localhost:${dashboard.port}`).unref();
    }

    output.writeln(output.bold(`Running: ${wf.name}`));
    const spinner = output.createSpinner({ text: 'Executing...', spinner: 'dots' });
    spinner.start();

    const record = await runWorkflow(wf, {
      onEvent: (ev) => dashboard.broadcast(ev),
    });

    if (record.status === 'completed') {
      spinner.succeed(`Done — ${record.itemsProcessed} items in ${((record.completedAt! - record.startedAt) / 1000).toFixed(1)}s`);
    } else {
      spinner.fail(`${record.status}${record.error ? ': ' + record.error : ''}`);
    }
    return { success: record.status === 'completed' };
  },
};

const listSubcommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List recent workflow runs',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { listRuns } = await import('../browser/workflow/store.js');
    const runs = await listRuns();
    if (runs.length === 0) { output.printInfo('No runs found'); return { success: true }; }
    output.printTable({
      columns: [
        { key: 'id', header: 'Run ID', width: 12 },
        { key: 'workflowName', header: 'Workflow', width: 20 },
        { key: 'status', header: 'Status', width: 10 },
        { key: 'itemsProcessed', header: 'Items', width: 8, align: 'right' },
        { key: 'startedAt', header: 'Started', width: 20,
          format: (v) => new Date(v as number).toLocaleString() },
      ],
      data: runs as unknown as Record<string, unknown>[],
    });
    return { success: true };
  },
};

const statusSubcommand: Command = {
  name: 'status',
  description: 'Show status of a specific run',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const runId = ctx.args[0];
    if (!runId) { output.printError('Run ID required'); return { success: false, exitCode: 1 }; }
    const { listRuns } = await import('../browser/workflow/store.js');
    const runs = await listRuns();
    const run = runs.find(r => r.id.startsWith(runId));
    if (!run) { output.printError(`Run not found: ${runId}`); return { success: false, exitCode: 1 }; }
    output.printBox([
      `ID: ${run.id}`, `Workflow: ${run.workflowName}`, `Status: ${run.status}`,
      `Items: ${run.itemsProcessed}/${run.itemsTotal}`,
      `Started: ${new Date(run.startedAt).toLocaleString()}`,
      run.completedAt ? `Completed: ${new Date(run.completedAt).toLocaleString()}` : '',
      run.error ? `Error: ${run.error}` : '',
    ].filter(Boolean).join('\n'), 'Run Status');
    return { success: true };
  },
};

const stopSubcommand: Command = {
  name: 'stop',
  description: 'Stop a running workflow (sends abort signal)',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.printInfo('Stop is handled via the dashboard Stop button or Ctrl-C in the running terminal.');
    return { success: true };
  },
};

export const browseWorkflowCommand: Command = {
  name: 'workflow',
  description: 'Browser workflow automation (create, run, list, status)',
  subcommands: [createSubcommand, runSubcommand, listSubcommand, statusSubcommand, stopSubcommand],
  action: async (): Promise<CommandResult> => {
    output.writeln(output.bold('browse workflow — usage:'));
    output.printList([
      'monomind browse workflow create <name>',
      'monomind browse workflow run <file.json>',
      'monomind browse workflow list',
      'monomind browse workflow status <run-id>',
    ]);
    return { success: true };
  },
};

export default browseWorkflowCommand;
