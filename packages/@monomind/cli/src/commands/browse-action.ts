// src/commands/browse-action.ts
import { Command } from 'commander';
import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyzePageForAction, type AnalyzerPage } from '../browser/action-builder/analyzer.js';
import { readAction } from '../browser/workflow/store.js';
import type { ActionDef } from '../browser/action-builder/types.js';

// Built-in actions (shipped with the CLI) — actual step definitions live in adapters/
const BUILTIN_ACTIONS: { id: string; platform: string; name: string }[] = [
  { id: 'linkedin:comment_post', platform: 'linkedin', name: 'Comment on Post' },
  { id: 'linkedin:like_post', platform: 'linkedin', name: 'Like Post' },
  { id: 'linkedin:send_connection', platform: 'linkedin', name: 'Send Connection Request' },
  { id: 'linkedin:publish_post', platform: 'linkedin', name: 'Publish Post' },
  { id: 'linkedin:keyword_search', platform: 'linkedin', name: 'Keyword Search' },
  { id: 'instagram:like_post', platform: 'instagram', name: 'Like Post' },
  { id: 'instagram:comment_post', platform: 'instagram', name: 'Comment on Post' },
  { id: 'instagram:follow_user', platform: 'instagram', name: 'Follow User' },
  { id: 'instagram:send_dm', platform: 'instagram', name: 'Send DM' },
  { id: 'instagram:hashtag_search', platform: 'instagram', name: 'Hashtag Search' },
  { id: 'x:like_post', platform: 'x', name: 'Like Post' },
  { id: 'x:reply_post', platform: 'x', name: 'Reply to Post' },
  { id: 'x:follow_user', platform: 'x', name: 'Follow User' },
  { id: 'x:publish_post', platform: 'x', name: 'Publish Post' },
  { id: 'x:keyword_search', platform: 'x', name: 'Keyword Search' },
  { id: 'gemini:submit_prompt', platform: 'gemini', name: 'Submit Prompt' },
  { id: 'gemini:extract_response', platform: 'gemini', name: 'Extract Response' },
];

async function getCustomActions(): Promise<ActionDef[]> {
  const dir = join(process.cwd(), '.monomind', 'actions');
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
  const results: ActionDef[] = [];
  for (const f of files) {
    try {
      results.push(await readAction(join(dir, f)));
    } catch {
      // skip malformed action files
    }
  }
  return results;
}

export function createActionCommand(): Command {
  const cmd = new Command('action').description('Manage browser actions');

  cmd
    .command('build')
    .description('AI-powered: analyze a page and generate an action definition')
    .requiredOption('--url <url>', 'URL to analyze')
    .requiredOption('--task <description>', 'What the action should do')
    .option('--output <file>', 'Output file path (default: .monomind/actions/<id>.json)')
    .action(async (opts: { url: string; task: string; output?: string }) => {
      console.log(`Analyzing ${opts.url} for task: "${opts.task}"`);
      console.log('Opening browser...');

      let actionDef: ActionDef;
      try {
        // Dynamic import to avoid crashing if CDP is unavailable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await (import('../browser/page-factory.js' as string) as Promise<any>).catch(() => null);
        const createBrowserPage = mod?.createBrowserPage as ((url: string) => Promise<AnalyzerPage>) | null;
        if (!createBrowserPage) {
          throw new Error('Browser CDP client not available. Ensure Chrome is running with --remote-debugging-port=9222');
        }
        const page = await createBrowserPage(opts.url);
        actionDef = await analyzePageForAction(page, opts.task);
      } catch (err) {
        console.error(`Action build failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      const dir = join(process.cwd(), '.monomind', 'actions');
      await mkdir(dir, { recursive: true });
      const outputPath = opts.output ?? join(dir, `${actionDef.id.replace(':', '-')}.json`);
      await writeFile(outputPath, JSON.stringify(actionDef, null, 2));
      console.log(`\nGenerated action: ${outputPath}`);
      console.log(`Action ID: ${actionDef.id}`);
      console.log(`Steps: ${actionDef.steps.length}`);
    });

  cmd
    .command('run <action-id>')
    .description('Run a single action')
    .requiredOption('--account <user>', 'Account username to use')
    .option('--params <pairs...>', 'Key=value params e.g. --params post_url=https://... text=hello')
    .action(async (actionId: string, opts: { account: string; params?: string[] }) => {
      const params: Record<string, string> = {};
      for (const pair of opts.params ?? []) {
        const eq = pair.indexOf('=');
        if (eq > 0) params[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      console.log(`Running action: ${actionId} with account: ${opts.account}`);
      console.log('Params:', params);
      console.log('(Action runner not yet implemented — use browse workflow run for full execution)');
    });

  cmd
    .command('list')
    .description('List available actions (built-in + custom)')
    .option('--platform <platform>', 'Filter by platform')
    .action(async (opts: { platform?: string }) => {
      const custom = await getCustomActions();
      const all = [
        ...BUILTIN_ACTIONS.map(a => ({ ...a, source: 'built-in' })),
        ...custom.map(a => ({ id: a.id, platform: a.platform, name: a.name, source: 'custom' })),
      ];
      const filtered = opts.platform ? all.filter(a => a.platform === opts.platform) : all;
      if (filtered.length === 0) {
        console.log('No actions found.');
        return;
      }
      console.log(`\n${'ID'.padEnd(40)} ${'PLATFORM'.padEnd(12)} ${'NAME'.padEnd(30)} SOURCE`);
      console.log('─'.repeat(90));
      for (const a of filtered) {
        console.log(`${a.id.padEnd(40)} ${a.platform.padEnd(12)} ${a.name.padEnd(30)} ${a.source}`);
      }
    });

  cmd
    .command('show <action-id>')
    .description('Print the action definition JSON')
    .action(async (actionId: string) => {
      // Check custom actions first
      const dir = join(process.cwd(), '.monomind', 'actions');
      const fileName = actionId.replace(':', '-') + '.json';
      const customPath = join(dir, fileName);
      if (existsSync(customPath)) {
        const def = await readAction(customPath);
        console.log(JSON.stringify(def, null, 2));
        return;
      }
      // Check built-ins
      const builtin = BUILTIN_ACTIONS.find(a => a.id === actionId);
      if (builtin) {
        console.log(JSON.stringify({ ...builtin, note: 'Built-in action — steps defined in browser/adapters/' }, null, 2));
        return;
      }
      console.error(`Action not found: ${actionId}`);
      process.exit(1);
    });

  return cmd;
}
