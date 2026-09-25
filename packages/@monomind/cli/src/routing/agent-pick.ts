/**
 * The one agent/skill pick every selector shares: `monomind pick`, the `pick`
 * MCP tool, `hooks route`, `hooks pre-task`, `hooks explain` and `route task`
 * all rank through rankForTask over the registry's agents and task skills, so
 * they cannot disagree. Every agent returned carries `name` — the spawnable
 * Task subagent_type.
 */
import { agentCatalog, taskSkillCatalog } from '../decision/catalogs.js';
import { keywordGateLeader } from '../decision/jev.js';
import {
  type RankedEntry,
  type RankOptions,
  rankForTask,
  type TaskRanking,
} from '../decision/picks.js';
import { getProjectCwd } from '../utils/paths.js';

export type PickKind = 'agents' | 'skills' | 'both';

export interface PickRequest {
  task: string;
  kind?: PickKind;
  categories?: string[];
  top?: number;
  root?: string;
  /** Passed to rankForTask (env, fetchImpl, include, minConfidence, ...). */
  options?: RankOptions;
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
  const options = { ...req.options };
  // `include.agents` may name agents by their spawnable name; the decision
  // model's candidates are keyed by registry id.
  if (options.include?.agents?.length) {
    const idOf = new Map(agents.map((a) => [a.name ?? a.id, a.id]));
    options.include = {
      ...options.include,
      agents: options.include.agents.map((n) => idOf.get(n) ?? n),
    };
  }
  // The outcome prior (.monomind/pick-stats.json) re-ranks keyword agents
  // here, so every selector sees the same order as the prompt hook.
  const result = await rankForTask(req.task, { agents, skills }, req.top ?? 5, {
    onError: warnDecisionUnavailable,
    priorsRoot: root,
    ...options,
  });
  return {
    ...result,
    agents: {
      ...result.agents,
      ranked: result.agents.ranked.map((e) => ({ ...e, name: spawnableName(e) })),
    },
  };
}

/** True when a ranked list of `kind` has a top worth acting on (the bar the
 *  prompt hook's [PICK] line uses; see RankedList.confident). */
export function pickConfident(ranking: TaskRanking, kind: PickKind = 'both'): boolean {
  return (
    (kind !== 'skills' && ranking.agents.confident === true) ||
    (kind !== 'agents' && ranking.skills.confident === true)
  );
}

/** One line for humans and prompts, `agent: <name> · skill: <invoke>`, naming
 *  only a confident top (as the [PICK] line does); `no confident match` when
 *  neither is. */
export function pickSummary(ranking: TaskRanking, kind: PickKind = 'both'): string {
  const parts: string[] = [];
  const agent = ranking.agents.confident ? ranking.agents.ranked[0] : undefined;
  const skill = ranking.skills.confident ? ranking.skills.ranked[0] : undefined;
  if (kind !== 'skills' && agent) parts.push(`agent: ${spawnableName(agent)}`);
  if (kind !== 'agents' && skill) parts.push(`skill: ${skill.invoke || skill.id}`);
  return parts.length ? parts.join(' · ') : 'no confident match';
}

/** Keyword scores are BM25-style relevance (pick-rank.cjs: IDF-weighted
 *  description matches plus a bonus for name/id words, scaled by the share of
 *  task words matched), typically 0–10; map them onto 0.4–0.9 so a strong
 *  match reads as confident. A decision-model answer keeps its probability. */
export function confidenceOf(entry: RankedEntry): number {
  const raw =
    entry.probability !== undefined
      ? entry.probability
      : Math.min(0.9, 0.4 + 0.05 * (entry.score ?? 0));
  return Math.round(raw * 100) / 100;
}

/** The top keyword-ranked agent when it clears the bar the prompt hook's
 *  [PICK] line uses (pick-rank.cjs KEYWORD_GATE: a minimum score and a lead
 *  over the runner-up), else null. Ties and weak overlap are no decision. */
export function keywordLeader(ranked: RankedEntry[]): RankedEntry | null {
  return keywordGateLeader(ranked, 'agents');
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
