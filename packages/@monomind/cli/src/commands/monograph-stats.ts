import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { formatErrorWithCause } from '../utils/native-error.js';
import { getDbPath } from './monograph-shared.js';

// ── stats subcommand ──────────────────────────────────────────────────────────

export const statsCommand: Command = {
  name: 'stats',
  description: 'Show knowledge graph statistics — node counts, edge types, top concepts',
  options: [
    { name: 'path', short: 'p', type: 'string', description: 'Root path (default: cwd)' },
    {
      name: 'top',
      type: 'number',
      description: 'Number of top concepts to show (default 10)',
      default: '10',
    },
  ],
  examples: [
    { command: 'monomind monograph stats', description: 'Show graph statistics' },
    { command: 'monomind monograph stats --top 20', description: 'Show top 20 concepts' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const root = resolve((ctx.flags.path as string | undefined) ?? process.cwd());
    const rawTop = parseInt((ctx.flags.top as string) || '10', 10);
    // Clamp top-N to prevent arbitrarily large SQL LIMIT values
    const top = Number.isFinite(rawTop) && rawTop > 0 ? Math.min(rawTop, 200) : 10;
    const dbPath = getDbPath(root);

    if (!existsSync(dbPath)) {
      output.printWarning('No knowledge graph found. Run: monomind monograph build');
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    output.writeln(output.bold('Monograph — Knowledge Graph Statistics'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln();

    try {
      await printStats(root, top, true);
      return { success: true };
    } catch (err) {
      output.printError(formatErrorWithCause(err));
      return { success: false, exitCode: 1 };
    }
  },
};

// ── shared helper ─────────────────────────────────────────────────────────────

export async function printStats(root: string, topN = 10, detailed = false): Promise<void> {
  const { openDb, closeDb } = await import('@monoes/monograph');
  const db = openDb(getDbPath(root));

  try {
    type Row = Record<string, unknown>;

    // Node counts by label
    const nodeCounts = db
      .prepare(`SELECT label, COUNT(*) as n FROM nodes GROUP BY label ORDER BY n DESC`)
      .all() as Row[];

    // Edge counts by relation
    const edgeCounts = db
      .prepare(`SELECT relation, COUNT(*) as n FROM edges GROUP BY relation ORDER BY n DESC`)
      .all() as Row[];

    // Top concepts by importance
    const topConcepts = db
      .prepare(`
      SELECT name,
             COALESCE(json_extract(properties, '$.importance'), 1) as importance,
             (SELECT COUNT(*) FROM edges WHERE target_id = nodes.id AND relation = 'TAGGED_AS') as sections
      FROM nodes WHERE label = 'Concept'
      ORDER BY importance DESC, sections DESC
      LIMIT ?
    `)
      .all(topN) as Row[];

    output.writeln(output.bold('  Nodes'));
    output.printTable({
      columns: [
        { key: 'label', header: 'Type', width: 18 },
        { key: 'count', header: 'Count', width: 10 },
        { key: 'bar', header: '', width: 30 },
      ],
      data: nodeCounts.map((r) => {
        const n = r.n as number;
        const max = (nodeCounts[0]?.n as number) ?? 1;
        const bars = Math.round((n / max) * 20);
        return {
          label: r.label as string,
          count: String(n),
          bar: output.dim('█'.repeat(bars) + '░'.repeat(20 - bars)),
        };
      }),
    });

    if (detailed) {
      output.writeln();
      output.writeln(output.bold('  Edges'));
      output.printTable({
        columns: [
          { key: 'relation', header: 'Relation', width: 22 },
          { key: 'count', header: 'Count', width: 10 },
        ],
        data: edgeCounts.map((r) => ({ relation: r.relation as string, count: String(r.n) })),
      });
    }

    if (topConcepts.length > 0) {
      output.writeln();
      output.writeln(output.bold(`  Top ${topN} Concepts by Importance`));
      output.printTable({
        columns: [
          { key: 'name', header: 'Concept', width: 28 },
          { key: 'importance', header: 'Importance', width: 12 },
          { key: 'sections', header: 'Sections', width: 10 },
        ],
        data: topConcepts.map((r) => ({
          name: r.name as string,
          importance: output.dim(
            '★'.repeat(r.importance as number) + '☆'.repeat(5 - (r.importance as number)),
          ),
          sections: String(r.sections ?? 0),
        })),
      });
    }

    // CO_OCCURS enrichment hint
    const coOccurCount = (
      db.prepare(`SELECT COUNT(*) as n FROM edges WHERE relation = 'CO_OCCURS'`).get() as {
        n: number;
      }
    ).n;
    const llmCount = (
      db.prepare(`SELECT COUNT(*) as n FROM edges WHERE confidence = 'INFERRED'`).get() as {
        n: number;
      }
    ).n;

    output.writeln();
    output.writeln(
      output.dim(`  CO_OCCURS edges: ${coOccurCount}   Inferred (heuristic) edges: ${llmCount}`),
    );
    output.writeln(output.dim(`  Database: ${getDbPath(root)}`));
  } finally {
    closeDb(db);
  }
}
