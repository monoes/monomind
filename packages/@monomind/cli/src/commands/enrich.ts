/**
 * CLI Enrich Command
 * Manage progressive content enrichment (T0/T1/T2 tiers)
 *
 * github.com/monoes/monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { EnrichmentPipeline } from '../capabilities/enrichment.js';
import path from 'path';

export const enrichCommand: Command = {
  name: 'enrich',
  description: 'Manage progressive content enrichment',
  options: [
    { name: 'status', description: 'Show enrichment progress', type: 'boolean' },
    { name: 'pause', description: 'Pause background enrichment', type: 'boolean' },
    { name: 'resume', description: 'Resume background enrichment', type: 'boolean' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const monomindDir = path.join(ctx.cwd, '.monomind');
    const pipeline = new EnrichmentPipeline();
    pipeline.loadState(monomindDir);

    if (ctx.flags.pause) {
      pipeline.pause();
      try {
        pipeline.saveState(monomindDir);
      } catch (err) {
        return { success: false, message: `Failed to save state: ${err instanceof Error ? err.message : String(err)}` };
      }
      return { success: true, message: 'Enrichment paused.' };
    }

    if (ctx.flags.resume) {
      pipeline.resume();
      try {
        pipeline.saveState(monomindDir);
      } catch (err) {
        return { success: false, message: `Failed to save state: ${err instanceof Error ? err.message : String(err)}` };
      }
      return { success: true, message: 'Enrichment resumed.' };
    }

    // Default: show status
    const summary = pipeline.getSummary();
    const output = [
      `Enrichment Status`,
      `─────────────────`,
      `Total files: ${summary.total}`,
      `T0 (metadata):  ${summary.t0Done}/${summary.total}`,
      `T1 (content):   ${summary.t1Done}/${summary.total}`,
      `T2 (AI):        ${summary.t2Done}/${summary.total}`,
      `Fully enriched: ${summary.fullyEnriched}/${summary.total}`,
      `Paused: ${pipeline.isPaused ? 'yes' : 'no'}`,
    ];
    console.log(output.join('\n'));

    return { success: true, data: summary };
  },
};

export default enrichCommand;
