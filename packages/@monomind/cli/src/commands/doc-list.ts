/**
 * `monomind doc list` — browsing the library rather than searching it
 * (RCL-09).
 *
 * @module v1/cli/commands/doc-list
 */

import type { LibrarySort } from '../knowledge/library.js';
import { getProjectRoot } from '../memory/memory-bridge.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { FILTER_OPTIONS, hasFilter, libraryFilterFromFlags } from './doc-filters.js';

export const listDocCommand: Command = {
  name: 'list',
  description: 'Browse indexed documents and captures (filter by site, tag, date, source)',
  aliases: ['library'],
  options: [
    { name: 'scope', short: 's', description: 'Knowledge scope', type: 'string' },
    {
      name: 'global',
      short: 'g',
      description: 'List the personal cross-project global brain',
      type: 'boolean',
    },
    ...FILTER_OPTIONS,
    {
      name: 'sort',
      description: 'captured (default) | indexed | title | path | size',
      type: 'string',
      default: 'captured',
    },
    { name: 'asc', description: 'Oldest first (default: newest first)', type: 'boolean' },
    { name: 'limit', short: 'l', description: 'Max rows', type: 'number' },
    { name: 'json', description: 'Emit JSON for programmatic use', type: 'boolean' },
    { name: 'facets', description: 'Show site/tag/collection/source counts', type: 'boolean' },
  ],
  examples: [
    { command: 'monomind doc list', description: 'Everything indexed, newest capture first' },
    {
      command: 'monomind doc list --site example.com --since 7d --json',
      description: 'This week from one site, for a GUI or a script',
    },
    {
      command: 'monomind doc list --tag reading --source extension --limit 20',
      description: 'A shelf of the library',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { getKnowledgeRoot, listDocuments } = await import('../knowledge/document-pipeline.js');
    const { libraryFacets, listLibrary } = await import('../knowledge/library.js');
    const isGlobal = ctx.flags.global === true;
    const scope = isGlobal ? 'global' : ctx.flags.scope ? String(ctx.flags.scope) : undefined;
    // The scope decides the store: `--scope profile:<id>` reads that profile's
    // brain, not the project's log filtered to a scope it never holds — which
    // listed nothing and looked like an empty library.
    const docs = listDocuments(getKnowledgeRoot(scope ?? 'shared', getProjectRoot()), scope);
    const filter = libraryFilterFromFlags(ctx);

    const rows = listLibrary(docs, {
      ...filter,
      sort: String(ctx.flags.sort || 'captured') as LibrarySort,
      order: ctx.flags.asc === true ? 'asc' : 'desc',
      ...(ctx.flags.limit ? { limit: Number(ctx.flags.limit) } : {}),
    });

    if (ctx.flags.json === true) {
      output.writeln(
        JSON.stringify(
          ctx.flags.facets === true ? { rows, facets: libraryFacets(docs) } : rows,
          null,
          2,
        ),
      );
      return { success: true, data: rows };
    }

    if (!rows.length) {
      output.writeln(
        output.dim(
          docs.length
            ? 'No documents match those filters.'
            : 'No documents indexed. Run: monomind doc ingest <path>',
        ),
      );
      return { success: true, data: [] };
    }

    const qualifier = hasFilter(filter) ? ` of ${docs.length}` : '';
    output.writeln(output.bold(`${rows.length}${qualifier} documents:`));
    output.writeln();

    for (const row of rows) {
      const size =
        row.size > 1024 * 1024
          ? `${(row.size / 1024 / 1024).toFixed(1)}MB`
          : `${(row.size / 1024).toFixed(0)}KB`;
      const facets = [
        row.site,
        row.source,
        row.collection,
        ...(row.tags.length ? [`#${row.tags.join(' #')}`] : []),
      ].filter(Boolean);
      output.writeln(
        `  ${output.highlight(row.title)} ${output.dim(`${row.capturedAt.slice(0, 10)} · ${row.chunkCount} chunks · ${size} · ${row.scope}`)}`,
      );
      if (facets.length) output.writeln(output.dim(`    ${facets.join(' · ')}`));
      if (row.url) output.writeln(output.dim(`    ${row.url}`));
    }

    if (ctx.flags.facets === true) {
      const facets = libraryFacets(docs);
      output.writeln();
      for (const [name, values] of Object.entries(facets)) {
        if (!values.length) continue;
        output.writeln(
          output.dim(`  ${name}: ${values.map((v) => `${v.value} (${v.count})`).join(', ')}`),
        );
      }
    }

    return { success: true, data: rows };
  },
};
