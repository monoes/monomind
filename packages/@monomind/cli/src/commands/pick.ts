/**
 * `monomind pick -t "<task>"` — the best agents and skills for a task. Asks the
 * Jev decision model when configured (MONOMIND_JEV_URL / TYPESAFE_API_KEY) and
 * falls back to keyword ranking, so scripts and skills always get an answer.
 */
import { readPickStats } from '../decision/pick-stats.js';
import type { RankedEntry, RankedList } from '../decision/picks.js';
import { output } from '../output.js';
import { pickForTask, pickSummary } from '../routing/agent-pick.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

const USAGE =
  'usage: monomind pick -t "<task>" [--agents | --skills] [--categories "a b"] [--top N] [--min-confidence P] [--explain] [--json]';

/** ` 3.10 = 2.90 × 1.07 prior`: how the outcome prior moved a keyword score. */
function priorNote(e: RankedEntry): string {
  if (e.prior === undefined || e.baseScore === undefined) return '';
  return ` ${(e.score ?? 0).toFixed(2)} = ${e.baseScore.toFixed(2)} × ${e.prior.toFixed(2)} prior`;
}

function pct(rate: number | null): string {
  return rate === null ? 'n/a' : `${Math.round(rate * 100)}%`;
}

/** The learning-loop numbers behind the prior (.monomind/pick-stats.json). */
function showStats(root: string): void {
  const s = readPickStats(root);
  console.log(
    `Pick history: ${s.routes} routes, ${s.shown} shown, ${s.spawns} spawns · adherence ${pct(s.adherenceRate)} · success followed ${pct(s.followedSuccessRate)} / overridden ${pct(s.notFollowedSuccessRate)}`,
  );
  for (const a of s.topAgents) {
    console.log(
      `  ${a.name}: recommended ${a.recommended}, followed ${a.followed}, overridden ${a.overridden}, chosen ${a.chosen}, success ${a.success}/${a.success + a.failure} → prior ×${a.prior.toFixed(2)}`,
    );
  }
}

/** Agents print their spawnable name (the id is the registry slug). */
function show(
  label: string,
  list: RankedList,
  provider: string | undefined,
  byName: boolean,
  explain = false,
): void {
  const how = list.method === 'jev' && provider ? `jev: ${provider}` : list.method;
  console.log(`${label} (${how}${list.lowConfidence ? ', low confidence' : ''})`);
  if (list.ranked.length === 0) console.log('  (no match)');
  for (const e of list.ranked) {
    const p = e.probability !== undefined ? ` ${e.probability.toFixed(2)}` : '';
    const d = e.description ? ` — ${e.description.replace(/\s+/g, ' ').slice(0, 100)}` : '';
    const why = explain ? priorNote(e) : '';
    console.log(`  ${output.highlight(byName ? (e.name ?? e.id) : e.id)}${p}${why}${d}`);
  }
}

export async function pickAction(ctx: CommandContext): Promise<CommandResult> {
  const task = typeof ctx.flags.task === 'string' ? ctx.flags.task.trim() : '';
  if (!task) {
    output.printError(USAGE);
    return { success: false, exitCode: 1, message: USAGE };
  }
  const rawFloor = ctx.flags['min-confidence'];
  const minConfidence = rawFloor === undefined ? undefined : Number(rawFloor);
  if (minConfidence !== undefined && !(minConfidence > 0 && minConfidence <= 1)) {
    const msg = `--min-confidence must be a number in (0, 1]\n${USAGE}`;
    output.printError(msg);
    return { success: false, exitCode: 1, message: msg };
  }
  const root = ctx.cwd || process.cwd();
  const onlyAgents = ctx.flags.agents === true && ctx.flags.skills !== true;
  const onlySkills = ctx.flags.skills === true && ctx.flags.agents !== true;
  const top = Math.max(1, Math.min(50, Number(ctx.flags.top) || 5));
  const categories =
    typeof ctx.flags.categories === 'string'
      ? ctx.flags.categories.split(/\s+/).filter(Boolean)
      : [];
  const explain = ctx.flags.explain === true;
  const kind = onlyAgents ? 'agents' : onlySkills ? 'skills' : 'both';
  // The same ranking as the `pick` MCP tool and the routing hooks.
  const result = await pickForTask({
    task,
    kind,
    categories,
    top,
    root,
    options: { minConfidence },
  });
  if (ctx.flags.json === true) {
    const summary = pickSummary(result, kind);
    const data = explain
      ? { ...result, summary, stats: readPickStats(root) }
      : { ...result, summary };
    console.log(JSON.stringify(data, null, 2));
    return { success: true, data };
  }
  if (!onlySkills) show('Agents', result.agents, result.provider, true, explain);
  if (!onlyAgents) show('Skills', result.skills, result.provider, false);
  if (explain) {
    if (result.agents.method === 'jev')
      console.log('(the outcome prior re-ranks keyword agent results only)');
    showStats(root);
  }
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
    {
      name: 'min-confidence',
      description:
        'Discard a decision-model answer below this probability (default MONOMIND_JEV_PICK_MIN_CONFIDENCE or 0.25)',
      type: 'number',
    },
    {
      name: 'explain',
      description: 'Show how the outcome prior (pick history) moved each keyword agent score',
      type: 'boolean',
    },
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
