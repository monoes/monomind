/**
 * Task-level picks on top of the Jev picker, each keeping the fallback its
 * caller had before: keyword ranking for `monomind pick` and org skill search,
 * a keyword role match for auto-assignment, and a keyword pool match for
 * per-task skills.
 */
import { keywordSkills, PICK_BRIEF_CHARS, pickTaskRole } from '../orgrt/task-match.js';
import type { OrgRole } from '../orgrt/types.js';
import { jevVisible, orgSkillCatalog } from './catalogs.js';
import {
  acceptAgent,
  acceptSkills,
  type CatalogItem,
  type JevAnswer,
  keywordRank,
  type PickOptions,
  pickWithJev,
} from './jev.js';

export interface RankedEntry {
  id: string;
  name?: string;
  category?: string;
  invoke?: string;
  source?: CatalogItem['source'];
  description?: string;
  probability?: number;
  score?: number;
}

export interface RankedList {
  method: 'jev' | 'keyword';
  ranked: RankedEntry[];
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
    .filter((r) => byId.has(r.id))
    .slice(0, top)
    .map((r) => ({ ...entry(byId.get(r.id) as CatalogItem), probability: r.probability }));
  return ranked.length ? ranked : null;
}

function fromKeywords(task: string, items: CatalogItem[], top: number): RankedEntry[] {
  return keywordRank(task, items, top).map((i) => ({ ...entry(i), score: i.score }));
}

export async function rankForTask(
  task: string,
  catalogs: { agents: CatalogItem[]; skills: CatalogItem[] },
  top: number,
  opts: PickOptions = {},
): Promise<TaskRanking> {
  const picked = await pickWithJev(
    task,
    {
      agents: catalogs.agents.length ? catalogs.agents : undefined,
      skills: catalogs.skills.length ? catalogs.skills : undefined,
    },
    opts,
  );
  // Below the confidence floor an answer is "no decision": keep keyword ranking.
  const agentAnswer = acceptAgent(picked?.agent, opts.env) ? picked?.agent : undefined;
  const skillAnswer =
    acceptSkills(picked?.skill, opts.env, top).length > 0 ? picked?.skill : undefined;
  const jevAgents = fromAnswer(agentAnswer, catalogs.agents, top);
  const jevSkills = fromAnswer(skillAnswer, catalogs.skills, top);
  return {
    ...(picked && (jevAgents || jevSkills) ? { provider: picked.provider } : {}),
    agents: jevAgents
      ? { method: 'jev', ranked: jevAgents }
      : { method: 'keyword', ranked: fromKeywords(task, catalogs.agents, top) },
    skills: jevSkills
      ? { method: 'jev', ranked: jevSkills }
      : { method: 'keyword', ranked: fromKeywords(task, catalogs.skills, top) },
  };
}

/** Up to two skills from a role's pool that fit this task; [] = no suggestion.
 *  Jev decides when it answers (its "none" included); without a decision
 *  model, or when it fails, a keyword match over the pool does. Either way
 *  only names from the pool can come back. */
export async function suggestTaskSkills(
  title: string,
  pool: string[],
  root: string,
  opts: PickOptions & { brief?: string; onMethod?: (method: 'jev' | 'keyword') => void } = {},
): Promise<string[]> {
  const { brief, onMethod, ...pickOpts } = opts;
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
  return keywordSkills({ title, brief }, skills, 2);
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
