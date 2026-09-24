/**
 * The one agent/skill pick every selector shares: `monomind pick`, the `pick`
 * MCP tool, `hooks route`, `hooks pre-task`, `hooks explain` and `route task`
 * all rank through rankForTask over the registry's agents and task skills, so
 * they cannot disagree. Every agent returned carries `name` — the spawnable
 * Task subagent_type.
 */
import { agentCatalog, taskSkillCatalog } from '../decision/catalogs.js';
import { type RankedEntry, rankForTask, type TaskRanking } from '../decision/picks.js';
import { getProjectCwd } from '../utils/paths.js';

export type PickKind = 'agents' | 'skills' | 'both';

export interface PickRequest {
  task: string;
  kind?: PickKind;
  categories?: string[];
  top?: number;
  root?: string;
}

/** A bundled core agent, used only when nothing in the registry ranks. */
export const FALLBACK_AGENT = 'coder';

export interface AgentSuggestion {
  /** Spawnable agent name (Task subagent_type). */
  type: string;
  confidence: number;
  reason: string;
}

export interface AgentPick {
  method: 'jev' | 'keyword' | 'fallback';
  provider?: string;
  agents: AgentSuggestion[];
}

function warnDecisionUnavailable(err: { provider: string; message: string }): void {
  process.stderr.write(`[pick] decision model "${err.provider}" unavailable (${err.message})\n`);
}

export function spawnableName(entry: RankedEntry): string {
  return entry.name || entry.id;
}

export async function pickForTask(req: PickRequest): Promise<TaskRanking> {
  const root = req.root ?? getProjectCwd();
  const kind = req.kind ?? 'both';
  const categories = req.categories ?? [];
  const agents =
    kind === 'skills'
      ? []
      : agentCatalog(root).filter(
          (a) => categories.length === 0 || categories.includes(a.category ?? ''),
        );
  const skills = kind === 'agents' ? [] : taskSkillCatalog(root);
  const result = await rankForTask(req.task, { agents, skills }, req.top ?? 5, {
    onError: warnDecisionUnavailable,
  });
  return {
    ...result,
    agents: {
      ...result.agents,
      ranked: result.agents.ranked.map((e) => ({ ...e, name: spawnableName(e) })),
    },
  };
}

/** One line for humans and prompts: `agent: <name> · skill: <invoke>`. */
export function pickSummary(ranking: TaskRanking, kind: PickKind = 'both'): string {
  const parts: string[] = [];
  const agent = ranking.agents.ranked[0];
  const skill = ranking.skills.ranked[0];
  if (kind !== 'skills' && agent) parts.push(`agent: ${spawnableName(agent)}`);
  if (kind !== 'agents' && skill) parts.push(`skill: ${skill.invoke || skill.id}`);
  return parts.length ? parts.join(' · ') : 'no match';
}

/** Keyword scores are word overlaps (name words 3, other words 1); map them
 *  onto 0.4–0.9 so a strong name match reads as confident. */
function confidenceOf(entry: RankedEntry): number {
  const raw =
    entry.probability !== undefined
      ? entry.probability
      : Math.min(0.9, 0.4 + 0.05 * (entry.score ?? 0));
  return Math.round(raw * 100) / 100;
}

/** Ranked agents in the `{type, confidence, reason}` shape the routing hooks
 *  return; never empty — `FALLBACK_AGENT` when nothing ranks. */
export async function pickAgents(task: string, top = 3, root?: string): Promise<AgentPick> {
  const ranking = await pickForTask({ task, kind: 'agents', top, root });
  const ranked = ranking.agents.ranked;
  if (ranked.length === 0) {
    return {
      method: 'fallback',
      agents: [
        { type: FALLBACK_AGENT, confidence: 0.3, reason: 'No registry agent matched the task' },
      ],
    };
  }
  const method = ranking.agents.method;
  return {
    method,
    ...(ranking.provider ? { provider: ranking.provider } : {}),
    agents: ranked.map((e) => ({
      type: spawnableName(e),
      confidence: confidenceOf(e),
      reason:
        method === 'jev'
          ? `Decision model${ranking.provider ? ` (${ranking.provider})` : ''} ranked this agent`
          : `Task words match this agent's name and description`,
    })),
  };
}
