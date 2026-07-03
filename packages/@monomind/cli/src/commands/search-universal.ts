/**
 * Universal Search Command
 *
 * Queries all activated capabilities via CapabilityManager.search() and
 * renders merged, score-ranked results grouped by content type.
 */
import type { Command, CommandContext, CommandResult } from '../types.js';
import type { SearchResult, CapabilityName } from '../capabilities/types.js';
import { CapabilityManager } from '../capabilities/manager.js';
import { loadFingerprint } from '../capabilities/scanner.js';
import { codeCapability } from '../capabilities/cap-code.js';
import { documentsCapability } from '../capabilities/cap-documents.js';
import { mediaCapability } from '../capabilities/cap-media.js';
import { dataCapability } from '../capabilities/cap-data.js';
import { graphCapability } from '../capabilities/cap-graph.js';
import { timelineCapability } from '../capabilities/cap-timeline.js';
import path from 'path';

const TYPE_ICONS: Record<string, string> = {
  documents: '📄',
  media: '📷',
  data: '📊',
  code: '💻',
  graph: '🔗',
  timeline: '📅',
};

const TYPE_LABELS: Record<string, string> = {
  documents: 'Documents',
  media: 'Photos & Media',
  data: 'Data Files',
  code: 'Code',
  graph: 'Related Files',
  timeline: 'Timeline',
};

export function groupByType(results: SearchResult[]): Partial<Record<CapabilityName, SearchResult[]>> {
  const grouped: Partial<Record<CapabilityName, SearchResult[]>> = {};
  for (const r of results) {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type]!.push(r);
  }
  return grouped;
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  const grouped = groupByType(results);
  const lines: string[] = [];

  for (const [type, items] of Object.entries(grouped)) {
    const icon = TYPE_ICONS[type] ?? '📁';
    const label = TYPE_LABELS[type] ?? type;
    lines.push(`\n${label}:`);
    for (const item of items as SearchResult[]) {
      lines.push(`  ${icon} ${item.path} — ${item.snippet}`);
    }
  }

  return lines.join('\n');
}

export const searchUniversalCommand: Command = {
  name: 'search',
  description: 'Search across all content types',
  options: [
    { name: 'limit', description: 'Max results', type: 'number' },
    { name: 'type', description: 'Filter by type (documents, media, data, code)', type: 'string' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = ctx.args.join(' ');
    if (!query) {
      return { success: false, message: 'Usage: monomind search <query>' };
    }

    const monomindDir = path.join(ctx.cwd, '.monomind');
    const fingerprint = await loadFingerprint(monomindDir);

    const mgr = new CapabilityManager();
    mgr.register(codeCapability);
    mgr.register(documentsCapability);
    mgr.register(mediaCapability);
    mgr.register(dataCapability);
    mgr.register(graphCapability);
    mgr.register(timelineCapability);

    if (fingerprint) {
      await mgr.activateFromScan(fingerprint, ctx.cwd);
    }

    const limit = (ctx.flags.limit as number) ?? 20;
    const results = await mgr.search(query, limit);

    const output = formatSearchResults(results);
    console.log(output);

    return { success: true };
  },
};

export default searchUniversalCommand;
