/**
 * Universal Search Command
 *
 * Queries all activated capabilities via CapabilityManager.search() and
 * renders merged, score-ranked results grouped by content type.
 */
import type { Command, CommandContext, CommandResult } from '../types.js';
import type { SearchResult, CapabilityName, DirectoryScan } from '../capabilities/types.js';
import { CapabilityManager } from '../capabilities/manager.js';
import { loadFingerprint, listFiles, scanDirectory, saveFingerprint } from '../capabilities/scanner.js';
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

/** Fingerprints older than this are considered stale and trigger a rescan. */
const FINGERPRINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Scan the working directory for content-type capabilities and persist an
 * updated fingerprint to .monomind/. Shared by `search scan` and the
 * auto-rescan path in `search` (formerly the standalone `scan` command).
 */
export async function runCapabilityScan(cwd: string): Promise<DirectoryScan> {
  const scan = await scanDirectory(cwd);
  const monomindDir = path.join(cwd, '.monomind');
  await saveFingerprint(scan, monomindDir);
  return scan;
}

function isFingerprintStale(scannedAt: string): boolean {
  const ts = new Date(scannedAt).getTime();
  return isNaN(ts) || Date.now() - ts > FINGERPRINT_MAX_AGE_MS;
}

const scanSubcommand: Command = {
  name: 'scan',
  description: 'Scan directory and update capability fingerprint',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const scan = await runCapabilityScan(ctx.cwd);

      console.log(`\nScanned ${scan.totalFiles} files in ${scan.root}`);
      console.log(`Git: ${scan.git ? 'yes' : 'no'}`);
      console.log(`\nCapabilities detected:`);

      for (const [name, score] of Object.entries(scan.capabilities)) {
        if (score.confidence > 0.1) {
          console.log(`  ✓ ${name} (${(score.confidence * 100).toFixed(0)}% confidence, ${score.files} files)`);
        }
      }

      const inactive = Object.entries(scan.capabilities).filter(([, s]) => s.confidence <= 0.1);
      if (inactive.length > 0) {
        console.log(`\nNot detected: ${inactive.map(([n]) => n).join(', ')}`);
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const searchUniversalCommand: Command = {
  name: 'search',
  description: 'Search across all content types',
  subcommands: [scanSubcommand],
  options: [
    { name: 'limit', description: 'Max results', type: 'number' },
    { name: 'type', description: 'Filter by type (documents, media, data, code)', type: 'string' },
  ],
  examples: [
    { command: 'monomind search "auth middleware"', description: 'Search all content types' },
    { command: 'monomind search scan', description: 'Rescan directory and update capability fingerprint' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = ctx.args.join(' ');
    if (!query) {
      return { success: false, message: 'Usage: monomind search <query>' };
    }

    const monomindDir = path.join(ctx.cwd, '.monomind');
    let fingerprint = await loadFingerprint(monomindDir);

    // Auto-scan when the fingerprint is missing or stale instead of bailing out
    if (!fingerprint || isFingerprintStale(fingerprint.scannedAt)) {
      console.log(fingerprint ? 'Capability fingerprint is stale — rescanning...' : 'No directory scan found — scanning...');
      try {
        const scan = await runCapabilityScan(ctx.cwd);
        fingerprint = { version: 1, ...scan };
      } catch (err) {
        return { success: false, message: `Scan failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    const mgr = new CapabilityManager();
    mgr.register(codeCapability);
    mgr.register(documentsCapability);
    mgr.register(mediaCapability);
    mgr.register(dataCapability);
    mgr.register(graphCapability);
    mgr.register(timelineCapability);

    try {
      await mgr.activateFromScan(fingerprint, ctx.cwd, false);

      const files = listFiles(ctx.cwd);
      for (const module of mgr.getActive()) {
        await module.index(files);
      }
    } catch (err) {
      return { success: false, message: `Failed to load capabilities: ${err instanceof Error ? err.message : String(err)}` };
    }

    const limit = (ctx.flags.limit as number) ?? 20;
    const results = await mgr.search(query, limit);

    const typeFilter = ctx.flags.type as CapabilityName | undefined;
    const filteredResults = typeFilter
      ? results.filter((r) => r.type === typeFilter)
      : results;

    const output = formatSearchResults(filteredResults);
    console.log(output);

    return { success: true };
  },
};

export default searchUniversalCommand;
