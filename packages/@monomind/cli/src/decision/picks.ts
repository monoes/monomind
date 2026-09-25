/**
 * Task-level picks on top of the Jev picker, each keeping the fallback its
 * caller had before: keyword ranking for `monomind pick` and org skill search,
 * a keyword role match for auto-assignment, and a keyword pool match for
 * per-task skills.
 */
import {
  keywordSkills,
  PICK_BRIEF_CHARS,
  pickTaskRole,
  skillOutcomePrior,
  type TaskOutcome,
} from '../orgrt/task-match.js';
import type { OrgRole } from '../orgrt/types.js';
import { jevVisible, orgSkillCatalog } from './catalogs.js';
import {
  acceptAgent,
  acceptSkills,
  automaticMinConfidence,
  type CatalogItem,
  decisionModelConfigured,
  type JevAnswer,
  keywordRank,
  type PickOptions,
  pickMinConfidence,
  pickWithJev,
} from './jev.js';
import { applyAgentPriors } from './pick-stats.js';

/** Jev tail entries under this probability are noise, not candidates. */
const MIN_RANKED_PROBABILITY = 0.02;

export interface RankedEntry {
  id: string;
  name?: string;
  category?: string;
  invoke?: string;
  source?: CatalogItem['source'];
  origin?: CatalogItem['origin'];
  description?: string;
  probability?: number;
  score?: number;
  /** Keyword agents re-ranked by the outcome prior: the relevance score
   *  before it and the factor applied (`score` = baseScore × prior). */
  baseScore?: number;
  prior?: number;
}

export interface RankedList {
  method: 'jev' | 'keyword';
  /** `jev`: the model's ranking; `keyword`: no model is configured;
   *  `keyword-fallback`: the model was asked but gave no usable answer or
   *  one below the pick floor. */
  source: 'jev' | 'keyword' | 'keyword-fallback';
  /** A Jev answer between the pick floor and the automatic-decision floor:
   *  worth showing, not worth acting on unattended. */
  lowConfidence: boolean;
  ranked: RankedEntry[];
}

export interface RankOptions extends PickOptions {
  /** Jev answers below this are discarded for keyword ranking. Defaults to
   *  MONOMIND_JEV_PICK_MIN_CONFIDENCE (0.25); pass automaticMinConfidence()
   *  to rank only answers an unattended caller would act on. */
  minConfidence?: number;
  /** Project root whose .monomind/pick-stats.json re-ranks keyword agent
   *  results (a bounded outcome prior). Omitted: plain keyword order. */
  priorsRoot?: string;
}

export interface TaskRanking {
  provider?: string;
  agents: RankedList;
  skills: RankedList;
}

function entry(item: CatalogItem): RankedEntry {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    invoke: item.invoke,
    source: item.source,
    ...(item.origin ? { origin: item.origin } : {}),
    description: item.description,
  };
}

function fromAnswer(
  answer: JevAnswer | undefined,
  items: CatalogItem[],
  top: number,
): RankedEntry[] | null {
  if (!answer) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const ranked = answer.ranked
    .filter(
      (r) => byId.has(r.id) && (r.id === answer.choice || r.probability >= MIN_RANKED_PROBABILITY),
    )
    .slice(0, top)
    .map((r) => ({ ...entry(byId.get(r.id) as CatalogItem), probability: r.probability }));
  return ranked.length ? ranked : null;
}

/** Keyword candidates the outcome prior may re-order before the list is cut. */
const PRIOR_WINDOW = 25;

function fromKeywords(
  task: string,
  items: CatalogItem[],
  top: number,
  priorsRoot?: string,
): RankedEntry[] {
  if (!priorsRoot)
    return keywordRank(task, items, top).map((i) => ({ ...entry(i), score: i.score }));
  return applyAgentPriors(priorsRoot, keywordRank(task, items, Math.max(top, PRIOR_WINDOW)))
    .slice(0, top)
    .map((i) => ({ ...entry(i), score: i.score, baseScore: i.baseScore, prior: i.prior }));
}

export async function rankForTask(
  task: string,
  catalogs: { agents: CatalogItem[]; skills: CatalogItem[] },
  top: number,
  opts: RankOptions = {},
): Promise<TaskRanking> {
  const { minConfidence, priorsRoot, ...pickOpts } = opts;
  const picked = await pickWithJev(
    task,
    {
      agents: catalogs.agents.length ? catalogs.agents : undefined,
      skills: catalogs.skills.length ? catalogs.skills : undefined,
    },
    pickOpts,
  );
  const floor = minConfidence ?? pickMinConfidence(opts.env);
  const automatic = automaticMinConfidence(opts.env);
  // Below the pick floor an answer is "no decision": keep keyword ranking.
  const agentAnswer = acceptAgent(picked?.agent, opts.env, floor) ? picked?.agent : undefined;
  const skillAnswer =
    acceptSkills(picked?.skill, opts.env, top, floor).length > 0 ? picked?.skill : undefined;
  const fallback = decisionModelConfigured(opts.env ?? process.env)
    ? 'keyword-fallback'
    : 'keyword';
  const list = (answer: JevAnswer | undefined, items: CatalogItem[], root?: string): RankedList => {
    const jev = fromAnswer(answer, items, top);
    return jev && answer
      ? { method: 'jev', source: 'jev', lowConfidence: answer.confidence < automatic, ranked: jev }
      : {
          method: 'keyword',
          source: fallback,
          lowConfidence: false,
          ranked: fromKeywords(task, items, top, root),
        };
  };
  const agents = list(agentAnswer, catalogs.agents, priorsRoot);
  const skills = list(skillAnswer, catalogs.skills);
  return {
    ...(picked && (agents.method === 'jev' || skills.method === 'jev')
      ? { provider: picked.provider }
      : {}),
    agents,
    skills,
  };
}

/** Up to two skills from a role's pool that fit this task; [] = no suggestion.
 *  Jev decides when it answers (its "none" included); without a decision
 *  model, or when it fails, a keyword match over the pool does, biased by
 *  `history` toward skills whose tasks finished done. Either way only names
 *  from the pool can come back. */
export async function suggestTaskSkills(
  title: string,
  pool: string[],
  root: string,
  opts: PickOptions & {
    brief?: string;
    onMethod?: (method: 'jev' | 'keyword') => void;
    history?: TaskOutcome[];
  } = {},
): Promise<string[]> {
  const { brief, onMethod, history, ...pickOpts } = opts;
  const skills = orgSkillCatalog(root, pool);
  if (skills.length === 0) return [];
  const excerpt = brief?.slice(0, PICK_BRIEF_CHARS);
  const picked = await pickWithJev(
    excerpt ? `${title}\n\n${excerpt}` : title,
    { skills },
    { ...pickOpts, skillInstructions: 'Which of these skills would help most with this task?' },
  );
  // Only names from the pool that was sent reach the assignee's mailbox.
  const sent = new Set(skills.map((s) => s.id));
  if (picked?.skill) {
    onMethod?.('jev');
    return acceptSkills(picked.skill, pickOpts.env, 2).filter((id) => sent.has(id));
  }
  onMethod?.('keyword');
  return keywordSkills(
    { title, brief },
    skills,
    2,
    history?.length ? skillOutcomePrior(history) : undefined,
  );
}

/** The role that should own a task: Jev first, then a keyword match (see
 *  orgrt/task-match.ts pickTaskRole for the rules and the provenance). */
export async function pickRoleForTask(
  title: string,
  roles: Pick<OrgRole, 'id' | 'title' | 'responsibilities'>[],
  opts: PickOptions = {},
): Promise<string | null> {
  return (await pickTaskRole({ title }, roles, opts)).role;
}

/** Re-rank `org skills search` keyword hits by Jev; unranked hits keep their
 *  keyword order after the ranked ones. Only hits `jevVisible` under `root`
 *  are sent; the others stay in keyword order among the unranked. */
export async function rankOrgSkills<
  T extends { name: string; description: string; tags: string[] },
>(
  query: string,
  found: T[],
  limit: number,
  opts: PickOptions & { root?: string } = {},
): Promise<{ method: 'jev' | 'keyword'; hits: (T & { probability?: number })[] }> {
  const keyword = { method: 'keyword' as const, hits: found.slice(0, limit) };
  if (found.length < 2) return keyword;
  const { root, ...pickOpts } = opts;
  const sendable = jevVisible(root, found);
  if (sendable.length === 0) return keyword;
  const picked = await pickWithJev(
    query,
    {
      skills: sendable.map((s) => ({
        id: s.name,
        description: s.description,
        text: s.tags.join(' '),
      })),
    },
    {
      ...pickOpts,
      maxCandidates: sendable.length,
      skillInstructions: 'Which skill best fits this need?',
    },
  );
  if (!picked?.skill || acceptSkills(picked.skill, opts.env, found.length).length === 0)
    return keyword;
  const prob = new Map(picked.skill.ranked.map((r) => [r.id, r.probability]));
  const ranked = found
    .filter((s) => prob.has(s.name))
    .sort((a, b) => (prob.get(b.name) ?? 0) - (prob.get(a.name) ?? 0))
    .map((s) => ({ ...s, probability: prob.get(s.name) }));
  const rest = found.filter((s) => !prob.has(s.name));
  return { method: 'jev', hits: [...ranked, ...rest].slice(0, limit) };
}
