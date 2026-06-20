// src/commands/browse-workflow.ts
import { Command } from 'commander';
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readWorkflow, listRuns, writeRunRecord } from '../browser/workflow/store.js';
import { runWorkflow } from '../browser/workflow/engine.js';
import { startDashboard } from '../browser/dashboard/server.js';
import { createBuiltinHandlers } from '../browser/workflow/builtin-handlers.js';
import type { WorkflowDef } from '../browser/workflow/types.js';

export function createWorkflowCommand(): Command {
  const cmd = new Command('workflow').description('Manage browser workflows');

  cmd
    .command('create <name>')
    .description('Scaffold a new workflow JSON file')
    .action(async (name: string) => {
      const dir = join(process.cwd(), '.monomind', 'workflows');
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${name}.json`);
      if (existsSync(file)) {
        console.error(`Workflow already exists: ${file}`);
        process.exit(1);
      }
      const template: WorkflowDef = {
        id: name,
        name: name.replace(/-/g, ' '),
        nodes: [
          { id: 'trigger', type: 'trigger.manual', config: {} },
        ],
        connections: [],
      };
      await writeFile(file, JSON.stringify(template, null, 2));
      console.log(`Created: ${file}`);
    });

  cmd
    .command('run <file>')
    .description('Execute a workflow and open the dashboard')
    .option('--port <number>', 'Dashboard port (default: MONOBROWSE_DASHBOARD_PORT or 4243)', '4243')
    .option('--no-keep', 'Exit immediately after run instead of keeping dashboard alive')
    .action(async (file: string, opts: { port: string; keep: boolean }) => {
      const filePath = resolve(file);
      let def: WorkflowDef;
      try {
        def = await readWorkflow(filePath);
      } catch (err) {
        console.error(`Failed to load workflow: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      const port = parseInt(process.env['MONOBROWSE_DASHBOARD_PORT'] ?? opts.port, 10);
      const dashboard = startDashboard(port);
      console.log(`Dashboard: http://localhost:${dashboard.port}`);
      console.log(`Running: ${def.name}`);

      const record = await runWorkflow(def, {
        handlers: createBuiltinHandlers(),
        onEvent: event => {
          dashboard.broadcast(event);
          if (event.eventType === 'step_completed' || event.eventType === 'step_failed') {
            const status = event.eventType === 'step_completed' ? '✓' : '✗';
            console.log(`  ${status} ${event.nodeName}${event.durationMs ? ` (${event.durationMs}ms)` : ''}`);
          }
        },
        signal: AbortSignal.timeout(5 * 60 * 1000), // 5 min timeout
      });

      dashboard.addRunRecord(record);
      await writeRunRecord(record);
      console.log(`\nCompleted: ${record.status} — ${record.itemsProcessed} items`);
      if (record.error) console.error(`Error: ${record.error}`);

      if (opts.keep !== false) {
        console.log(`\nDashboard kept alive at http://localhost:${dashboard.port} — press Ctrl+C to exit`);
        // Keep process alive; SIGINT/SIGTERM will close cleanly
        process.on('SIGINT', () => { dashboard.close(); process.exit(0); });
        process.on('SIGTERM', () => { dashboard.close(); process.exit(0); });
      } else {
        process.exit(record.status === 'completed' ? 0 : 1);
      }
    });

  cmd
    .command('list')
    .description('List available workflows and their last run status')
    .action(async () => {
      const dir = join(process.cwd(), '.monomind', 'workflows');
      if (!existsSync(dir)) {
        console.log('No workflows found. Create one with: browse workflow create <name>');
        return;
      }
      const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
      if (files.length === 0) {
        console.log('No workflows found.');
        return;
      }
      const runs = await listRuns();
      for (const file of files) {
        const id = file.replace('.json', '');
        const lastRun = runs.find(r => r.workflowId === id);
        const status = lastRun ? `[${lastRun.status}]` : '[never run]';
        console.log(`  ${id}  ${status}`);
      }
    });

  cmd
    .command('status <run-id>')
    .description('Check the status of a specific run')
    .action(async (runId: string) => {
      const runs = await listRuns();
      const run = runs.find(r => r.id === runId);
      if (!run) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }
      console.log(JSON.stringify(run, null, 2));
    });

  cmd
    .command('stop <run-id>')
    .description('Request cancellation of a running workflow')
    .action(async (runId: string) => {
      const dash = startDashboard();
      if (!dash.isStopRequested(runId)) {
        // The engine must be polling isStopRequested — we signal via dashboard
        console.log(`Stop requested for run: ${runId}`);
        console.log('Note: If the workflow is not running in this process, use the dashboard stop button at http://localhost:4242');
      } else {
        console.log(`Stop already requested for: ${runId}`);
      }
    });

  return cmd;
}
