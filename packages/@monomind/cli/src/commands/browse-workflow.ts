// src/commands/browse-workflow.ts
import { Command } from 'commander';
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readWorkflow, listRuns, writeRunRecord, runWorkflow, createBuiltinHandlers } from '@monoes/monobrowse';
import { startDashboard } from '@monoes/monobrowse';
import type { WorkflowDef } from '@monoes/monobrowse';

export function createWorkflowCommand(): Command {
  const cmd = new Command('playbook')
    .alias('workflow')
    .description('Manage browser playbooks (saved automation recipes)');

  cmd
    .command('create <name>')
    .description('Scaffold a new workflow JSON file')
    .option('--template <type>', 'Starter template: minimal | http | google-sheets | gmail | microsoft | gemini-image', 'minimal')
    .action(async (name: string, opts: { template: string }) => {
      const dir = join(process.cwd(), '.monomind', 'workflows');
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${name}.json`);
      if (existsSync(file)) {
        console.error(`Workflow already exists: ${file}`);
        process.exit(1);
      }

      const humanName = name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      let def: WorkflowDef;

      switch (opts.template) {
        case 'http':
          def = {
            id: name, name: humanName,
            description: 'Fetch data from an HTTP endpoint and save to file',
            nodes: [
              { id: 'trigger', type: 'trigger.manual', name: 'Start', config: { items: [{ data: { url: 'https://api.example.com/data' } }] } },
              { id: 'fetch', type: 'action.http', name: 'Fetch Data', config: { url: '{{$json.url}}', method: 'GET' }, onError: 'skip' },
              { id: 'log', type: 'action.log', name: 'Log Result', config: { label: 'result' } },
              { id: 'save', type: 'action.save_file', name: 'Save JSON', config: { path: `./output/${name}-result.json` } },
            ],
            connections: [{ from: 'trigger', to: 'fetch' }, { from: 'fetch', to: 'log' }, { from: 'log', to: 'save' }],
          };
          break;

        case 'google-sheets':
          def = {
            id: name, name: humanName,
            description: 'Read rows from Google Sheets and process them',
            params: { spreadsheetId: { required: true, description: 'Google Sheets ID from URL' }, range: { default: 'Sheet1', description: 'Cell range e.g. Sheet1!A:Z' } },
            nodes: [
              { id: 'trigger', type: 'trigger.manual', name: 'Start', config: {} },
              { id: 'read', type: 'action.google_sheets_read', name: 'Read Sheet', config: { spreadsheetId: '{{params.spreadsheetId}}', range: '{{params.range}}' } },
              { id: 'log', type: 'action.log', name: 'Log Rows', config: { label: 'row' } },
            ],
            connections: [{ from: 'trigger', to: 'read' }, { from: 'read', to: 'log' }],
          };
          break;

        case 'gmail':
          def = {
            id: name, name: humanName,
            description: 'Send emails via Gmail API',
            params: { to: { required: true, description: 'Recipient email address' }, subject: { required: true }, body: { required: true } },
            nodes: [
              { id: 'trigger', type: 'trigger.manual', name: 'Start', config: { items: [{ data: {} }] } },
              { id: 'send', type: 'action.gmail_send', name: 'Send Email', config: { to: '{{params.to}}', subject: '{{params.subject}}', body: '{{params.body}}' } },
              { id: 'log', type: 'action.log', name: 'Log Result', config: { label: 'sent' } },
            ],
            connections: [{ from: 'trigger', to: 'send' }, { from: 'send', to: 'log' }],
          };
          break;

        case 'microsoft':
          def = {
            id: name, name: humanName,
            description: 'Call Microsoft Graph API (Outlook, Teams, OneDrive)',
            params: { endpoint: { default: '/me/messages', description: 'Graph API endpoint' } },
            nodes: [
              { id: 'trigger', type: 'trigger.manual', name: 'Start', config: { items: [{ data: {} }] } },
              { id: 'graph', type: 'action.microsoft_graph', name: 'Graph API Call', config: { endpoint: '{{params.endpoint}}', method: 'GET' } },
              { id: 'log', type: 'action.log', name: 'Log Result', config: { label: 'graph' } },
            ],
            connections: [{ from: 'trigger', to: 'graph' }, { from: 'graph', to: 'log' }],
          };
          break;

        case 'gemini-image':
          def = {
            id: name, name: humanName,
            description: 'Generate images using Gemini via browser or API',
            params: { prompt: { required: true, description: 'Image generation prompt' } },
            nodes: [
              { id: 'trigger', type: 'trigger.manual', name: 'Start', config: { items: [{ data: {} }] } },
              { id: 'generate', type: 'action.gemini_image', name: 'Generate Image', config: { prompt: '{{params.prompt}}', outputPath: `./output/${name}.png` }, onError: 'skip' },
              { id: 'log', type: 'action.log', name: 'Log Result', config: { label: 'generated' } },
            ],
            connections: [{ from: 'trigger', to: 'generate' }, { from: 'generate', to: 'log' }],
          };
          break;

        default: // minimal
          def = {
            id: name, name: humanName,
            description: 'New workflow',
            nodes: [
              { id: 'trigger', type: 'trigger.manual', name: 'Start', config: { items: [{ data: { message: 'hello' } }] } },
              { id: 'log', type: 'action.log', name: 'Log', config: { label: name } },
            ],
            connections: [{ from: 'trigger', to: 'log' }],
          };
      }

      await writeFile(file, JSON.stringify(def, null, 2));
      console.log(`Created: ${file}`);
      console.log(`Template: ${opts.template}`);
      if (def.params) {
        console.log(`Params: ${Object.entries(def.params).map(([k, v]) => `${k}${v.required ? ' (required)' : ''}`).join(', ')}`);
      }
      console.log(`Run with: npx monomind browse workflow run ${file}`);
    });

  cmd
    .command('run <file>')
    .description('Execute a workflow and open the dashboard')
    .option('--port <number>', 'Dashboard port (default: MONOBROWSE_DASHBOARD_PORT or 4242)', '4242')
    .option('--no-keep', 'Exit immediately after run instead of keeping dashboard alive')
    .option('--params <pairs...>', 'Workflow params as key=value pairs e.g. --params name=Alice count=5')
    .option('--timeout <seconds>', 'Max run time in seconds (default: 900)', '900')
    .action(async (file: string, opts: { port: string; keep: boolean; params?: string[]; timeout: string }) => {
      const filePath = resolve(file);
      let def: WorkflowDef;
      try {
        def = await readWorkflow(filePath);
      } catch (err) {
        console.error(`Failed to load workflow: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      // Parse --params key=value pairs
      const params: Record<string, string> = {};
      for (const pair of opts.params ?? []) {
        const eq = pair.indexOf('=');
        if (eq > 0) params[pair.slice(0, eq)] = pair.slice(eq + 1);
      }

      // Validate required params
      if (def.params) {
        for (const [key, spec] of Object.entries(def.params)) {
          if (spec.required && !(key in params) && spec.default === undefined) {
            console.error(`Missing required workflow param: ${key}${spec.description ? ` (${spec.description})` : ''}`);
            process.exit(1);
          }
          // Apply defaults
          if (!(key in params) && spec.default !== undefined) {
            params[key] = String(spec.default);
          }
        }
      }

      const port = parseInt(process.env['MONOBROWSE_DASHBOARD_PORT'] ?? opts.port, 10);
      const dashboard = startDashboard(port);
      console.log(`Dashboard: http://localhost:${dashboard.port}`);
      console.log(`Running: ${def.name}`);
      if (Object.keys(params).length > 0) {
        console.log(`Params: ${JSON.stringify(params)}`);
      }

      const timeoutMs = parseInt(opts.timeout, 10) * 1000;
      // Resolve the project directory once so every event carries the same canonical tag.
      const projectDir = process.cwd();
      const record = await runWorkflow(def, {
        handlers: createBuiltinHandlers(),
        onEvent: event => {
          dashboard.broadcast({ ...event, projectDir });
          if (event.eventType === 'step_completed' || event.eventType === 'step_failed') {
            const status = event.eventType === 'step_completed' ? '✓' : '✗';
            console.log(`  ${status} ${event.nodeName}${event.durationMs ? ` (${event.durationMs}ms)` : ''}`);
          }
        },
        signal: AbortSignal.timeout(timeoutMs),
        params,
      });

      dashboard.addRunRecord(record);
      await writeRunRecord(record);
      console.log(`\nCompleted: ${record.status} — ${record.itemsProcessed} items`);
      if (record.error) console.error(`Error: ${record.error}`);

      if (opts.keep !== false) {
        console.log(`\nDashboard kept alive at http://localhost:${dashboard.port} — press Ctrl+C to exit`);
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
    .description('Request cancellation of a running workflow via dashboard')
    .option('--port <number>', 'Dashboard port (default: MONOBROWSE_DASHBOARD_PORT or 4242)', '4242')
    .action(async (runId: string, opts: { port: string }) => {
      const port = parseInt(process.env['MONOBROWSE_DASHBOARD_PORT'] ?? opts.port, 10);
      // Try to signal via HTTP POST to the dashboard server
      try {
        const res = await fetch(`http://127.0.0.1:${port}/stop/${runId}`, { method: 'POST' });
        if (res.ok) {
          console.log(`Stop requested for run: ${runId}`);
          console.log(`Dashboard: http://localhost:${port}`);
        } else {
          console.error(`Dashboard returned ${res.status}. Is a workflow running on port ${port}?`);
        }
      } catch {
        console.error(`Could not reach dashboard on port ${port}. Make sure the workflow is running.`);
        console.error(`You can also use the Stop button in the dashboard: http://localhost:${port}`);
        process.exit(1);
      }
    });

  return cmd;
}
