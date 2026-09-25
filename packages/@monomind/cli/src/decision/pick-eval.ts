/**
 * Offline evaluation of agent/skill picking: tasks with every acceptable
 * agent and skill id, scored as top-1 / top-3 hits. The eval set lives in a
 * source checkout under tests/pick-eval/ (dataset.json, holdout.json and a
 * frozen catalog snapshot); `pnpm run pick:eval` (scripts/pick-eval.mjs), the
 * tests/pick-eval regression guard and `monomind doctor -c pick` all score
 * through this module.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentCatalog, skillIndex } from './catalogs.js';
import { type CatalogItem, jevModule, keywordGateLeader, keywordRank } from './jev.js';

export type EvalKind = 'agents' | 'skills';

/** One task. `agents` / `skills` list EVERY acceptable id; an empty list
 *  means "no expectation" and the task is not scored for that kind. */
export interface EvalTask {
  id: number;
  task: string;
  domain?: string;
  agents: string[];
  skills: string[];
  /** Nothing in the catalogs fits: the gated pick must show nothing. */
  noPick?: boolean;
}

export interface EvalCatalogs {
  agents: CatalogItem[];
  skills: CatalogItem[];
}

export interface EvalMiss {
  id: number;
  task: string;
  expected: string[];
  got: string[];
  /** 1-based position of the first acceptable id within the ranked list, or
   *  null when none was ranked. */
  rank: number | null;
}

export interface KindScore {
  /** Tasks scored for this kind (those with at least one expected id). */
  n: number;
  top1: number;
  top3: number;
  /** Tasks whose top-1 was not acceptable. */
  misses: EvalMiss[];
}

export interface EvalReport {
  tasks: number;
  agents: KindScore;
  skills: KindScore;
}

/** Ranked ids per kind for one task (at least the top 3). */
export interface TaskPicks {
  agents: string[];
  skills: string[];
}

export const EVAL_TOP = 3;

export function evalDir(root: string): string {
  return join(root, 'tests', 'pick-eval');
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** dataset.json + holdout.json under tests/pick-eval, or null outside a
 *  checkout that carries the eval set. */
export function readEvalTasks(
  root: string,
  sets: string[] = ['dataset', 'holdout'],
): EvalTask[] | null {
  const dir = evalDir(root);
  const out: EvalTask[] = [];
  for (const set of sets) {
    const list = readJson<EvalTask[]>(join(dir, `${set}.json`));
    if (!Array.isArray(list)) return null;
    out.push(...list);
  }
  return out;
}

/** The frozen catalog snapshot (catalog-snapshot.json), or null. */
export function readEvalSnapshot(root: string): EvalCatalogs | null {
  const file = join(evalDir(root), 'catalog-snapshot.json');
  if (!existsSync(file)) return null;
  const snap = readJson<EvalCatalogs>(file);
  return snap && Array.isArray(snap.agents) && Array.isArray(snap.skills) ? snap : null;
}

/**
 * The project's live catalogs as the picker sees them, minus the user's
 * personal ~/.claude/skills so a score means the same on every machine.
 */
export function projectCatalogs(root: string): EvalCatalogs {
  const agents = agentCatalog(root);
  const index = skillIndex(root, { user: false });
  const skills = jevModule()?.loadSkillCatalog(root, index ? { index } : undefined) ?? [];
  return { agents, skills };
}

/** Score ranked picks against the tasks' acceptable ids. */
export function scorePicks(tasks: EvalTask[], picks: TaskPicks[]): EvalReport {
  const kind = (k: EvalKind): KindScore => {
    const score: KindScore = { n: 0, top1: 0, top3: 0, misses: [] };
    tasks.forEach((t, i) => {
      const expected = t[k];
      if (!expected.length) return;
      score.n++;
      const ok = new Set(expected);
      const got = (picks[i]?.[k] ?? []).slice(0, EVAL_TOP);
      const at = got.findIndex((id) => ok.has(id));
      if (at === 0) score.top1++;
      if (at !== -1) score.top3++;
      if (at !== 0)
        score.misses.push({
          id: t.id,
          task: t.task,
          expected,
          got,
          rank: at === -1 ? null : at + 1,
        });
    });
    return score;
  };
  return { tasks: tasks.length, agents: kind('agents'), skills: kind('skills') };
}

/** Keyword-only picks for every task (in-process, no network). */
export function keywordPicks(tasks: EvalTask[], catalogs: EvalCatalogs): TaskPicks[] {
  return tasks.map((t) => ({
    agents: keywordRank(t.task, catalogs.agents, EVAL_TOP).map((i) => i.id),
    skills: keywordRank(t.task, catalogs.skills, EVAL_TOP).map((i) => i.id),
  }));
}

export function keywordEval(tasks: EvalTask[], catalogs: EvalCatalogs): EvalReport {
  return scorePicks(tasks, keywordPicks(tasks, catalogs));
}

/** Expected ids a catalog does not contain (a stale expectation). */
export function unknownExpectations(
  tasks: EvalTask[],
  catalogs: EvalCatalogs,
): { id: number; kind: EvalKind; missing: string[] }[] {
  const known = {
    agents: new Set(catalogs.agents.map((a) => a.id)),
    skills: new Set(catalogs.skills.map((s) => s.id)),
  };
  const out: { id: number; kind: EvalKind; missing: string[] }[] = [];
  for (const t of tasks)
    for (const kind of ['agents', 'skills'] as const) {
      const missing = t[kind].filter((id) => !known[kind].has(id));
      if (missing.length) out.push({ id: t.id, kind, missing });
    }
  return out;
}

export function formatScore(s: KindScore): string {
  return `top1 ${s.top1}/${s.n}, top3 ${s.top3}/${s.n}`;
}

/** What the gated pick (the [PICK] bar: pick-rank.cjs KEYWORD_GATE) showed
 *  for one kind. `precision` = correct / shown; a show on a `noPick` task, or
 *  of an id the task does not accept, is wrong. */
export interface GatedScore {
  /** Tasks judged: those with an expectation for this kind, plus noPick tasks. */
  n: number;
  shown: number;
  correct: number;
  precision: number | null;
  wrong: { id: number; task: string; shown: string }[];
}

/** Keyword picks through the prompt hook's gate: how often it shows one, and
 *  how often what it shows is right. */
export function gatedEval(
  tasks: EvalTask[],
  catalogs: EvalCatalogs,
): { agents: GatedScore; skills: GatedScore } {
  const kind = (k: EvalKind): GatedScore => {
    const score: GatedScore = { n: 0, shown: 0, correct: 0, precision: null, wrong: [] };
    for (const t of tasks) {
      if (!t.noPick && t[k].length === 0) continue;
      score.n++;
      const leader = keywordGateLeader(keywordRank(t.task, catalogs[k], 5), k);
      if (!leader) continue;
      score.shown++;
      if (!t.noPick && t[k].includes(leader.id)) score.correct++;
      else score.wrong.push({ id: t.id, task: t.task, shown: leader.id });
    }
    score.precision = score.shown ? Math.round((1000 * score.correct) / score.shown) / 1000 : null;
    return score;
  };
  return { agents: kind('agents'), skills: kind('skills') };
}
