// packages/@monomind/cli/src/commands/org-visualize.ts
// Generate Mermaid flow diagrams from org run events
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { ORG_DIR } from '../orgrt/types.js';
import { readRunEvents, listRunDirs } from '../orgrt/reporting.js';
import { generateMermaidFlow } from '../orgrt/visualization.js';

const log = (text: string): void => { console.log(text); };

// Run ids are joined into filesystem paths — enforce the daemon's own id shape
// so a crafted --run can't traverse out of the org directory (same reason the
// org-name guard exists).
const RUN_ID_RE = /^run-[A-Za-z0-9-]+$/;

const resolveRun = (cwd: string, name: string, runFlag: unknown): string | null => {
  if (typeof runFlag === 'string' && runFlag) return RUN_ID_RE.test(runFlag) ? runFlag : null;
  return listRunDirs(cwd, name)[0] ?? null;
};

export async function orgVisualize(ctx: CommandContext, name: string): Promise<CommandResult> {
  const run = resolveRun(ctx.cwd, name, ctx.flags['run']);
  if (!run) return { success: false, message: `no runs found for org ${name} — start one with: monomind org run ${name}` };

  const events = readRunEvents(ctx.cwd, name, run);
  if (!events.length) return { success: false, message: `run ${run} has no recorded events` };

  const mermaid = generateMermaidFlow(events);
  log(output.info(`Mermaid flow diagram for ${name} / ${run}:`));
  log(mermaid);

  return { success: true, message: `Mermaid flow diagram generated for ${name} / ${run}` };
}
