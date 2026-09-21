/**
 * Library commands for the capture brain: `doc cite`, `doc related`,
 * `doc watch` (RCL-10, RCL-03, RCL-08).
 *
 * They live beside `doc.ts` rather than inside it because that file is
 * already long, and because these three share one piece of logic worth
 * having in exactly one place: WHICH STORE a capture is in. Captures land in
 * `~/.monomind/inbox`, which is outside any project, so `doc ingest` routes
 * them to the personal global brain — asking about them from inside a project
 * must therefore look in both stores before reporting "not indexed", or the
 * commands would deny knowing pages the user just saved.
 *
 * @module v1/cli/commands/doc-library
 */

import * as path from 'node:path';
import { getGlobalBrainDir, getProjectRoot } from '../memory/memory-bridge.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

interface Store {
  root: string;
  scope: string;
  global: boolean;
}

function projectStore(ctx: CommandContext): Store {
  return {
    root: getProjectRoot(ctx.cwd || process.cwd()),
    scope: String(ctx.flags.scope || 'shared'),
    global: false,
  };
}

function globalStore(): Store {
  return { root: getGlobalBrainDir(), scope: 'global', global: true };
}

/**
 * The store holding `target`: the one the flags name, or — with no flag — the
 * project first and the personal brain second, because that is where captures
 * actually live.
 */
async function resolveStore(ctx: CommandContext, target?: string): Promise<Store> {
  if (ctx.flags.global === true || ctx.flags.scope === 'global') return globalStore();
  const project = projectStore(ctx);
  if (ctx.flags.scope || !target) return project;
  const { findDocumentRecord } = await import('../knowledge/document-pipeline.js');
  if (findDocumentRecord(project.root, target, project.scope)) return project;
  return findDocumentRecord(globalStore().root, target, 'global') ? globalStore() : project;
}

const STORE_OPTIONS = [
  {
    name: 'scope',
    short: 's',
    description: 'Knowledge scope (default: shared)',
    type: 'string' as const,
  },
  {
    name: 'global',
    short: 'g',
    description: 'Use the personal cross-project global brain',
    type: 'boolean' as const,
  },
  { name: 'json', description: 'Emit JSON for programmatic use', type: 'boolean' as const },
];

const asJson = (ctx: CommandContext): boolean => ctx.flags.json === true;

function printJson(data: unknown): CommandResult {
  output.writeln(JSON.stringify(data, null, 2));
  return { success: true, data };
}

// ── doc cite (RCL-10) ──────────────────────────────────────────────

const citeCommand: Command = {
  name: 'cite',
  description: 'Quote a passage from an indexed document, with its URL and capture time',
  options: [
    {
      name: 'chunk',
      short: 'c',
      description: 'Chunk index, as reported by search',
      type: 'number',
    },
    {
      name: 'anchor',
      short: 'a',
      description: 'Citation anchor from a search hit',
      type: 'string',
    },
    { name: 'full', description: 'Print the whole passage, not just the quote', type: 'boolean' },
    ...STORE_OPTIONS,
  ],
  examples: [
    {
      command: 'monomind doc cite https://example.com/post --chunk 2',
      description: 'Quote chunk 2 of a captured page',
    },
    {
      command: 'monomind doc cite ./readable.md --anchor 3f1a9c7b21de#3200-6400 --json',
      description: 'Resolve an anchor from a search result',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.args[0];
    if (!target) {
      output.printError('Document required: monomind doc cite <url|docId|path> --chunk <n>');
      return { success: false, exitCode: 1 };
    }
    const store = await resolveStore(ctx, target);
    const { resolveCitation } = await import('../knowledge/citation.js');

    try {
      const cite = await resolveCitation(target, {
        rootDir: store.root,
        scope: store.scope,
        ...(ctx.flags.anchor ? { anchor: String(ctx.flags.anchor) } : {}),
        ...(ctx.flags.chunk !== undefined ? { chunkIndex: Number(ctx.flags.chunk) } : {}),
      });
      if (asJson(ctx)) return printJson(cite);

      output.writeln();
      output.writeln(`  ${output.bold(`"${ctx.flags.full ? cite.passage.trim() : cite.quote}"`)}`);
      output.writeln();
      output.writeln(`  ${output.highlight(cite.title ?? path.basename(cite.filePath))}`);
      if (cite.citeUrl) output.writeln(`  ${cite.citeUrl}`);
      const when = cite.capturedAt
        ? `captured ${cite.capturedAt}`
        : `indexed from ${cite.filePath}`;
      output.writeln(
        output.dim(
          `  ${when} · chunk ${cite.chunkIndex} · chars ${cite.startChar}-${cite.endChar} · ${cite.anchor}`,
        ),
      );
      if (cite.stale) {
        // Never presented as if it were still true: the document has been
        // re-captured since these offsets were measured.
        output.printWarning(
          '  This anchor was cut against an older version of the page — the passage may have moved.',
        );
      }
      output.writeln();
      return { success: true, data: cite };
    } catch (err) {
      output.printError(String(err instanceof Error ? err.message : err));
      return { success: false, exitCode: 1 };
    }
  },
};

// ── doc related (RCL-03) ───────────────────────────────────────────

const relatedCommand: Command = {
  name: 'related',
  description: 'What else in the brain relates to this page',
  options: [
    {
      name: 'limit',
      short: 'l',
      description: 'Max results (default: 3)',
      type: 'number',
      default: 3,
    },
    {
      name: 'timeout',
      description: 'Budget in ms for the similarity pass (default: 2000)',
      type: 'number',
    },
    { name: 'min-score', description: 'Minimum similarity (default: 0.25)', type: 'number' },
    ...STORE_OPTIONS,
  ],
  examples: [
    {
      command: 'monomind doc related https://example.com/post --limit 3 --json',
      description: 'What the extension asks at capture time',
    },
    {
      command: 'monomind doc related ~/.monomind/inbox/2026-09-21-post/readable.md',
      description: 'Ask about a capture that has not been ingested yet',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.args[0];
    if (!target) {
      output.printError('Page required: monomind doc related <url|docId|path>');
      return { success: false, exitCode: 1 };
    }
    const store = await resolveStore(ctx, target);
    const { relatedDocuments } = await import('../knowledge/related.js');

    const related = await relatedDocuments(target, {
      rootDir: store.root,
      scope: store.scope,
      limit: Number(ctx.flags.limit || 3),
      ...(ctx.flags.timeout !== undefined ? { timeoutMs: Number(ctx.flags.timeout) } : {}),
      ...(ctx.flags['min-score'] !== undefined ? { minScore: Number(ctx.flags['min-score']) } : {}),
    });

    if (asJson(ctx)) return printJson(related);
    if (!related.length) {
      output.writeln(output.dim('Nothing related yet.'));
      return { success: true, data: [] };
    }

    output.writeln(output.bold(`${related.length} related:`));
    for (let i = 0; i < related.length; i++) {
      const r = related[i];
      output.writeln(
        `  ${output.highlight(`${i + 1}.`)} ${r.title} ${output.dim(`(${r.score.toFixed(2)}) [${r.reasons.join(', ')}]`)}`,
      );
      if (r.url) output.writeln(output.dim(`     ${r.url}`));
      if (r.excerpt) output.writeln(output.dim(`     ${r.excerpt}`));
    }
    return { success: true, data: related };
  },
};

// ── doc watch (RCL-08) ─────────────────────────────────────────────

const watchAddCommand: Command = {
  name: 'add',
  description: 'Watch a captured page for change',
  options: [
    {
      name: 'interval',
      short: 'i',
      description: 'How often a check should consider it due: 30m, 6h, 2d (default: 1d)',
      type: 'string',
    },
    { name: 'label', description: 'Name for this watch (default: the page title)', type: 'string' },
    ...STORE_OPTIONS,
  ],
  examples: [
    {
      command: 'monomind doc watch add https://example.com/pricing --interval 6h',
      description: 'Notice the next time this page is re-captured',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.args[0];
    if (!target) {
      output.printError('Page required: monomind doc watch add <url|docId|path>');
      return { success: false, exitCode: 1 };
    }
    const store = await resolveStore(ctx, target);
    const { addWatch } = await import('../knowledge/watch.js');
    try {
      const entry = await addWatch(store.root, target, {
        scope: store.scope,
        ...(ctx.flags.interval ? { interval: String(ctx.flags.interval) } : {}),
        ...(ctx.flags.label ? { label: String(ctx.flags.label) } : {}),
      });
      if (asJson(ctx)) return printJson(entry);
      output.writeln(
        `Watching ${output.highlight(entry.label ?? entry.url)} every ${entry.intervalSeconds}s`,
      );
      if (!entry.lastHash) {
        output.writeln(output.dim('  Nothing indexed under it yet — the first check will say so.'));
      }
      return { success: true, data: entry };
    } catch (err) {
      output.printError(String(err instanceof Error ? err.message : err));
      return { success: false, exitCode: 1 };
    }
  },
};

const watchListCommand: Command = {
  name: 'list',
  description: 'Show the watch list',
  aliases: ['ls'],
  options: STORE_OPTIONS,
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const store = await resolveStore(ctx);
    const { listWatches } = await import('../knowledge/watch.js');
    const project = listWatches(store.root);
    // With no flag, show both stores: a watch added for a capture lives in the
    // personal brain, and an empty list here would be a lie.
    const includeGlobal = !ctx.flags.global && !ctx.flags.scope && !store.global;
    const watches = includeGlobal ? [...project, ...listWatches(globalStore().root)] : project;

    if (asJson(ctx)) return printJson(watches);
    if (!watches.length) {
      output.writeln(output.dim('No watches. Add one: monomind doc watch add <url>'));
      return { success: true, data: [] };
    }
    output.writeln(output.bold(`${watches.length} watched:`));
    for (const w of watches) {
      const last = w.lastCheckedAt ? `checked ${w.lastCheckedAt.slice(0, 16)}Z` : 'never checked';
      output.writeln(
        `  ${output.highlight(w.label ?? w.url)} ${output.dim(`every ${w.intervalSeconds}s · ${last} · ${w.scope}`)}`,
      );
      if (w.label) output.writeln(output.dim(`    ${w.url}`));
    }
    return { success: true, data: watches };
  },
};

const watchRemoveCommand: Command = {
  name: 'remove',
  description: 'Stop watching a page',
  aliases: ['rm'],
  options: STORE_OPTIONS,
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.args[0];
    if (!target) {
      output.printError('Page required: monomind doc watch remove <url|label>');
      return { success: false, exitCode: 1 };
    }
    const { removeWatch } = await import('../knowledge/watch.js');
    const store = await resolveStore(ctx, target);
    const removed =
      removeWatch(store.root, target) ||
      (!ctx.flags.global && !ctx.flags.scope && removeWatch(globalStore().root, target));
    if (!removed) {
      output.printError(`Not watched: ${target}`);
      return { success: false, exitCode: 1 };
    }
    output.writeln(`Stopped watching ${output.highlight(target)}`);
    return { success: true, data: { url: target } };
  },
};

const watchCheckCommand: Command = {
  name: 'check',
  description: 'Report which watched pages changed since the last check',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Check every watch, ignoring its interval',
      type: 'boolean',
    },
    { name: 'dry-run', description: 'Report without moving the baselines', type: 'boolean' },
    ...STORE_OPTIONS,
  ],
  examples: [
    { command: 'monomind doc watch check --json', description: 'What a scheduler calls' },
    {
      command: 'monomind doc watch check --force',
      description: 'Check everything now, whatever the intervals say',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const store = await resolveStore(ctx);
    const { checkWatches } = await import('../knowledge/watch.js');
    const opts = {
      force: ctx.flags.force === true,
      dryRun: ctx.flags['dry-run'] === true,
    };
    const reports = [await checkWatches(store.root, opts)];
    if (!ctx.flags.global && !ctx.flags.scope && !store.global) {
      reports.push(await checkWatches(globalStore().root, opts));
    }
    const report = {
      checked: reports.reduce((n, r) => n + r.checked, 0),
      changed: reports.reduce((n, r) => n + r.changed, 0),
      skipped: reports.reduce((n, r) => n + r.skipped, 0),
      results: reports.flatMap((r) => r.results),
    };

    if (asJson(ctx)) return printJson(report);
    if (!report.results.length) {
      output.writeln(output.dim('No watches. Add one: monomind doc watch add <url>'));
      return { success: true, data: report };
    }
    const changed = report.results.filter((r) => r.status === 'changed');
    if (!changed.length) {
      output.writeln(
        `Nothing changed ${output.dim(`(${report.checked} checked, ${report.skipped} not due)`)}`,
      );
    }
    for (const r of changed) {
      output.writeln(output.bold(`${r.title ?? r.url} changed`));
      output.writeln(output.dim(`  ${r.url}${r.version ? ` · version ${r.version}` : ''}`));
      if (r.diff) {
        output.writeln(`  ${r.diff.summary}`);
        for (const c of r.diff.changed.slice(0, 5)) {
          if (c.sample) output.writeln(output.dim(`    ${c.key}: ${c.sample}`));
        }
      } else if (r.note) {
        output.writeln(output.dim(`  ${r.note}`));
      }
    }
    for (const r of report.results.filter((x) => x.status === 'missing')) {
      output.writeln(output.dim(`${r.url}: ${r.note}`));
    }
    return { success: true, data: report };
  },
};

const watchCommand: Command = {
  name: 'watch',
  description: 'Watch captured pages for change (checked on demand — no daemon)',
  subcommands: [watchAddCommand, watchListCommand, watchRemoveCommand, watchCheckCommand],
  options: [],
  examples: [
    {
      command: 'monomind doc watch add https://example.com/pricing -i 6h',
      description: 'Watch a page',
    },
    { command: 'monomind doc watch check --json', description: 'What changed since last time' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln('Usage: monomind doc watch <add|list|remove|check> [options]');
    output.printList([
      `${output.highlight('add')}    - Watch a captured page for change`,
      `${output.highlight('list')}   - Show the watch list`,
      `${output.highlight('remove')} - Stop watching a page`,
      `${output.highlight('check')}  - Report what changed (invoked by a scheduler, not a daemon)`,
    ]);
    return { success: true };
  },
};

export const libraryCommands: Command[] = [citeCommand, relatedCommand, watchCommand];
export { citeCommand, relatedCommand, watchCommand };
