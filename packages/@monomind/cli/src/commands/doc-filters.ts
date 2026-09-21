/**
 * Library filter flags (RCL-09), shared by `doc list` and `doc search`.
 *
 * One definition of the facets, so the two surfaces cannot drift into
 * meaning different things by `--site`.
 *
 * @module v1/cli/commands/doc-filters
 */

import type { LibraryFilter } from '../knowledge/library.js';
import type { CommandContext, CommandOption } from '../types.js';

/**
 * Repeated flags arrive as arrays, a single one as a string, and `--tag a,b`
 * is the shorthand people type anyway; all three land as a list here.
 */
export const FILTER_OPTIONS: CommandOption[] = [
  {
    name: 'site',
    description: 'Filter by site — a bare domain covers its subdomains',
    type: 'array',
  },
  { name: 'tag', description: 'Filter by capture tag (repeatable)', type: 'array' },
  { name: 'collection', description: 'Filter by collection', type: 'array' },
  {
    name: 'source',
    description: 'Filter by capture source: extension | monobrowse | crawl',
    type: 'array',
  },
  {
    name: 'since',
    description: 'Captured on or after: 2026-09-01, or an age like 7d',
    type: 'string',
  },
  {
    name: 'until',
    description: 'Captured on or before: 2026-09-20, or an age like 1d',
    type: 'string',
  },
  { name: 'captured', description: 'Only pages captured from the web', type: 'boolean' },
  // A substring filter over title, URL, path and note — for finding a shelf of
  // the library by name. It is NOT a URL lookup: an exact "is this page
  // saved?" is `doc lookup`, which matches on capture identity rather than on
  // a substring, and answers with the note as well.
  { name: 'text', description: 'Substring match over title, URL, path and note', type: 'string' },
];

export function flagList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const items = raw
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

export function libraryFilterFromFlags(ctx: CommandContext): LibraryFilter {
  return {
    ...(flagList(ctx.flags.site) ? { site: flagList(ctx.flags.site) } : {}),
    ...(flagList(ctx.flags.tag) ? { tag: flagList(ctx.flags.tag) } : {}),
    ...(flagList(ctx.flags.collection) ? { collection: flagList(ctx.flags.collection) } : {}),
    ...(flagList(ctx.flags.source) ? { source: flagList(ctx.flags.source) } : {}),
    ...(ctx.flags.since ? { since: String(ctx.flags.since) } : {}),
    ...(ctx.flags.until ? { until: String(ctx.flags.until) } : {}),
    ...(ctx.flags.captured === true ? { capturedOnly: true } : {}),
    ...(ctx.flags.text ? { text: String(ctx.flags.text) } : {}),
  };
}

export const hasFilter = (f: LibraryFilter): boolean => Object.keys(f).length > 0;
