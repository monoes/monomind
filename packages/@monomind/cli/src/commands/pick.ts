/**
 * `monomind pick -t "<task>"` — the best agents and skills for a task. Asks the
 * Jev decision model when configured (MONOMIND_JEV_URL / TYPESAFE_API_KEY) and
 * falls back to keyword ranking, so scripts and skills always get an answer.
 */
import { agentCatalog, taskSkillCatalog } from '../decision/catalogs.js';
import { type RankedList, rankForTask } from '../decision/picks.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

const USAGE =
  'usage: monomind pick -t "<task>" [--agents | --skills] [--categories "a b"] [--top N] [--json]';

function show(label: string, list: RankedList, provider?: string): void {
  console.log(`${label} (${list.method === 'jev' && provider ? `jev: ${provider}` : list.method})`);
  if (list.ranked.length === 0) console.log('  (no match)');
  for (const e of list.ranked) {
    const p = e.probability !== undefined ? ` ${e.probability.toFixed(2)}` : '';
    const d = e.description ? ` — ${e.description.replace(/\s+/g, ' ').slice(0, 100)}` : '';
    console.log(`  ${output.highlight(e.id)}${p}${d}`);
  }
}

export async function pickAction(ctx: CommandContext): Promise<CommandResult> {
  const task = typeof ctx.flags.task === 'string' ? ctx.flags.task.trim() : '';
  if (!task) {
    output.printError(USAGE);
    return { success: false, exitCode: 1, message: USAGE };
  }
  const root = ctx.cwd || process.cwd();
  const onlyAgents = ctx.flags.agents === true && ctx.flags.skills !== true;
  const onlySkills = ctx.flags.skills === true && ctx.flags.agents !== true;
  const top = Math.max(1, Math.min(50, Number(ctx.flags.top) || 5));
  const categories =
    typeof ctx.flags.categories === 'string'
      ? ctx.flags.categories.split(/\s+/).filter(Boolean)
      : [];
  const agents = onlySkills
    ? []
    : agentCatalog(root).filter(
        (a) => categories.length === 0 || categories.includes(a.category ?? ''),
      );
  const skills = onlyAgents ? [] : taskSkillCatalog(root);
  const result = await rankForTask(task, { agents, skills }, top, {
    onError: (err) =>
      process.stderr.write(
        `[pick] decision model "${err.provider}" unavailable (${err.message})\n`,
      ),
  });
  if (ctx.flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return { success: true, data: result };
  }
  if (!onlySkills) show('Agents', result.agents, result.provider);
  if (!onlyAgents) show('Skills', result.skills, result.provider);
  return { success: true, data: result };
}

export const pickCommand: Command = {
  name: 'pick',
  description: 'Pick the best agents and skills for a task (Jev decision model, keyword fallback)',
  options: [
    { name: 'task', short: 't', description: 'Task description', type: 'string' },
    { name: 'agents', description: 'Rank agents only', type: 'boolean' },
    { name: 'skills', description: 'Rank skills only', type: 'boolean' },
    {
      name: 'categories',
      description: 'Space-separated agent categories to consider',
      type: 'string',
    },
    { name: 'top', description: 'Entries per list (1-50)', type: 'number', default: 5 },
    { name: 'json', description: 'Output JSON', type: 'boolean' },
  ],
  examples: [
    {
      command: 'monomind pick -t "audit the API for injection risks"',
      description: 'Agents and skills',
    },
    {
      command: 'monomind pick -t "landing page copy" --agents --categories "marketing" --json',
      description: 'Marketing agents as JSON',
    },
  ],
  action: pickAction,
};
