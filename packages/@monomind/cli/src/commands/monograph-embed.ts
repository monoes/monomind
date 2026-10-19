import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getEmbedder } from '../mcp-tools/monograph/semantic.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { formatErrorWithCause } from '../utils/native-error.js';
import { getDbPath } from './monograph-shared.js';

// ── embed subcommand ──────────────────────────────────────────────────────────

export const embedCommand: Command = {
  name: 'embed',
  description:
    'Embed symbol and document summaries so search can answer plain-language questions (incremental, resumable)',
  options: [
    { name: 'path', short: 'p', type: 'string', description: 'Root path (default: cwd)' },
    {
      name: 'max-seconds',
      type: 'number',
      description: 'Stop after this long; run again to continue (default: no limit)',
    },
  ],
  examples: [
    { command: 'monomind monograph embed', description: 'Embed everything that is new or changed' },
    {
      command: 'monomind monograph embed --max-seconds 120',
      description: 'Work for two minutes, then stop',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const root = resolve((ctx.flags.path as string | undefined) ?? process.cwd());
    const dbPath = getDbPath(root);
    if (!existsSync(dbPath)) {
      output.printWarning('No knowledge graph found. Run: monomind monograph build');
      return { success: false, exitCode: 1 };
    }
    const embedder = await getEmbedder();
    if (!embedder) {
      output.printWarning(
        'Embedding model unavailable (or MONOGRAPH_EMBED=0). Run: monomind download-embeddings',
      );
      return { success: false, exitCode: 1 };
    }
    const maxSeconds = Number(ctx.flags['max-seconds']);
    const { openDb, closeDb, embedPending, embeddingStatus } = await import('@monoes/monograph');
    const db = openDb(dbPath);
    try {
      let lastShown = 0;
      const { embedded, remaining } = await embedPending(db, embedder, {
        maxMs: Number.isFinite(maxSeconds) && maxSeconds > 0 ? maxSeconds * 1000 : undefined,
        onProgress: (done, pending) => {
          if (done - lastShown >= 1000 || done === pending) {
            lastShown = done;
            output.writeln(output.dim(`  embedded ${done}/${pending}`));
          }
        },
      });
      const status = embeddingStatus(db);
      output.writeln(
        `Embedded ${embedded} new; ${status.embedded}/${status.total} summaries searchable semantically` +
          (remaining > 0 ? ` (${remaining} left — run again)` : ''),
      );
      return { success: true };
    } catch (err) {
      output.printError(formatErrorWithCause(err));
      return { success: false, exitCode: 1 };
    } finally {
      closeDb(db);
    }
  },
};
