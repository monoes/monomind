/**
 * Org task matching: which role should own a task (`org_task` with
 * `assignee: "auto"`) and which of a role's pool skills fit it, without a
 * decision model.
 *
 * The keyword scorer drops stopwords, weighs each word by how rare it is
 * among the candidates (a word every role mentions — "the", the org's shared
 * rules skill, "worktree" — tells nothing apart), counts title words double
 * and the title's leading verb (titles are imperative) double again, and
 * requires a minimum score. Equal scores are broken by role specificity
 * (deeper in the reporting tree, then the narrower description), never by
 * the order roles are declared in; a tie that survives that is reported as
 * ambiguous instead of being guessed.
 */

import { roleCatalog } from '../decision/catalogs.js';
import { acceptAgent, type PickOptions, pickWithJev } from '../decision/jev.js';
import { agentRoles } from './endpoint-roles.js';
import type { OrgDef, OrgRole } from './types.js';

/** How much of a task brief the pickers read. */
export const PICK_BRIEF_CHARS = 600;
/** The lowest keyword score that assigns a role / suggests a skill. */
export const MIN_ROLE_SCORE = 1.5;
export const MIN_SKILL_SCORE = 1.5;

const STOPWORDS = new Set(
  (
    'a an the and or but nor to of for in on at by with from into onto over under ' +
    'as is are was were be been being it its this that these those there here ' +
    'i me my we our you your he she they them their his her ' +
    'do does did done doing have has had will would shall should can could may might must ' +
    'not no yes if then than so such very just also only all any each every some more most ' +
    'up out about after before again when where which who whom what why how ' +
    'please task tasks work make sure new via per etc e g ie'
  ).split(' '),
);

/** Suffix stripping so "publisher"/"publish" and "releases"/"release" meet. */
function stem(t: string): string {
  if (t.length <= 3) return t;
  const s = t.replace(/(ings?|ers?|ed|es|e|s)$/, '');
  return s.length >= 3 ? s : t.replace(/s$/, '');
}

export function matchTokens(text: string | undefined): string[] {
  return (
    String(text ?? '')
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  )
    .filter((t) => !STOPWORDS.has(t))
    .map(stem);
}

export interface MatchDoc {
  id: string;
  /** Identity text (id, title / name): a hit here weighs 3. */
  strong: string;
  /** Descriptive text: a hit here weighs 1. */
  weak: string;
}

export interface MatchScore {
  id: string;
  score: number;
  matched: string[];
}

export interface TaskText {
  title: string;
  brief?: string;
}

/** Every doc with a positive score, highest first (equal scores keep input
 *  order — callers that must not favour order break ties themselves). */
export function scoreDocs(task: TaskText, docs: MatchDoc[]): MatchScore[] {
  const titleWords = matchTokens(task.title);
  const title = new Set(titleWords);
  // Task titles are imperative: the leading verb says what kind of work it is.
  const verb = titleWords[0];
  const brief = new Set(matchTokens(task.brief?.slice(0, PICK_BRIEF_CHARS)));
  const query = new Set([...title, ...brief]);
  if (query.size === 0 || docs.length === 0) return [];
  const sets = docs.map((d) => ({
    id: d.id,
    strong: new Set(matchTokens(d.strong)),
    weak: new Set(matchTokens(d.weak)),
  }));
  const n = sets.length;
  const idf = new Map<string, number>();
  for (const t of query) {
    const df = sets.filter((s) => s.strong.has(t) || s.weak.has(t)).length;
    if (df) idf.set(t, Math.log((n + 1) / df));
  }
  return sets
    .map((s) => {
      let score = 0;
      const matched: string[] = [];
      for (const t of query) {
        const hit = s.strong.has(t) ? 3 : s.weak.has(t) ? 1 : 0;
        if (!hit) continue;
        score += hit * (t === verb ? 4 : title.has(t) ? 2 : 1) * (idf.get(t) ?? 0);
        matched.push(t);
      }
      return { id: s.id, score: Math.round(score * 1000) / 1000, matched };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ── Outcome prior ──────────────────────────────────────────────────────────

/** A finished task as the prior reads it (an OrgTask row fits). */
export interface TaskOutcome {
  title: string;
  assignee: string;
  status: string;
  loadedSkills?: string[];
}

/** Observations a role/skill needs before its history moves a ranking. */
export const PRIOR_MIN_OBS = 3;
/** Largest relative move of the prior: factors lie in [1 - span, 1 + span]. */
export const PRIOR_SPAN = 0.15;
/** Title-word overlap (Jaccard) that makes a past task "similar". */
const SIMILAR_JACCARD = 0.2;

/** Beta(1,1)-smoothed success rate mapped to [1 - PRIOR_SPAN, 1 + PRIOR_SPAN];
 *  1 below PRIOR_MIN_OBS outcomes. */
export function outcomeFactor(success: number, failure: number): number {
  const n = success + failure;
  if (n < PRIOR_MIN_OBS) return 1;
  return Math.round((1 + 2 * PRIOR_SPAN * ((1 + success) / (2 + n) - 0.5)) * 1000) / 1000;
}

function outcomeOf(status: string): boolean | null {
  return status === 'done' ? true : status === 'failed' ? false : null;
}

function tally(tasks: TaskOutcome[], keys: (t: TaskOutcome) => string[]): (key: string) => number {
  const counts = new Map<string, { s: number; f: number }>();
  for (const t of tasks) {
    const ok = outcomeOf(t.status);
    if (ok === null) continue;
    for (const k of keys(t)) {
      const c = counts.get(k) ?? { s: 0, f: 0 };
      if (ok) c.s++;
      else c.f++;
      counts.set(k, c);
    }
  }
  return (key) => {
    const c = counts.get(key);
    return c ? outcomeFactor(c.s, c.f) : 1;
  };
}

/** Per-role factor from how each role did on past tasks similar to `task`
 *  (done = success, failed = failure). */
export function roleOutcomePrior(
  task: TaskText,
  history: TaskOutcome[],
): (roleId: string) => number {
  const q = new Set(matchTokens(task.title));
  const similar = history.filter((t) => {
    const w = new Set(matchTokens(t.title));
    const inter = [...w].filter((x) => q.has(x)).length;
    const union = new Set([...w, ...q]).size;
    return union > 0 && inter / union >= SIMILAR_JACCARD;
  });
  return tally(similar, (t) => [t.assignee]);
}

/** Per-skill factor from the outcomes of the tasks that loaded it. */
export function skillOutcomePrior(history: TaskOutcome[]): (skill: string) => number {
  return tally(history, (t) => [...new Set(t.loadedSkills ?? [])]);
}

type PickableRole = Pick<OrgRole, 'id' | 'title' | 'responsibilities'> &
  Partial<Pick<OrgRole, 'reports_to' | 'kind'>>;

/** Provenance of an 'auto' assignment, recorded on the task (OrgTask.pick). */
export interface TaskPick {
  method: 'only' | 'jev' | 'keyword';
  /** Jev's confidence in the chosen role. */
  confidence?: number;
  /** The chosen role's keyword score. */
  score?: number;
  /** The best candidates considered (Jev probability or keyword score). */
  candidates: { id: string; score?: number }[];
}

export interface RolePick {
  /** null = no role fits (or the best ones tie); the caller must name one. */
  role: string | null;
  method: 'only' | 'jev' | 'keyword' | 'none';
  /** Jev's confidence in `role`. */
  confidence?: number;
  /** The keyword score of `role`. */
  score?: number;
  /** The best-scoring candidates, for the audit trail (at most 3). */
  candidates: { id: string; score?: number }[];
  reason?: 'no-candidates' | 'no-match' | 'ambiguous';
}

function depth(role: PickableRole, byId: Map<string, PickableRole>): number {
  let d = 0;
  const seen = new Set<string>();
  for (let r = role; r.reports_to && !seen.has(r.id); d++) {
    seen.add(r.id);
    const up = byId.get(r.reports_to);
    if (!up) break;
    r = up;
  }
  return d;
}

/** Keyword pick over `candidates`; `all` supplies the reporting tree. Roles
 *  that clear MIN_ROLE_SCORE rank by score × `prior` (roleOutcomePrior), so
 *  history breaks near-ties but cannot move a role past a 1.35× gap. */
export function keywordRole(
  task: TaskText,
  candidates: PickableRole[],
  all: PickableRole[] = candidates,
  load?: (roleId: string) => number,
  prior?: (roleId: string) => number,
): RolePick {
  const scored = scoreDocs(
    task,
    candidates.map((r) => ({
      id: r.id,
      strong: `${r.id} ${r.title}`,
      weak: (r.responsibilities ?? []).join('\n'),
    })),
  );
  const top3 = scored.slice(0, 3).map(({ id, score }) => ({ id, score }));
  const adjusted = scored
    .filter((s) => s.score >= MIN_ROLE_SCORE)
    .map((s) => ({ ...s, adj: Math.round(s.score * (prior?.(s.id) ?? 1) * 1000) / 1000 }))
    .sort((a, b) => b.adj - a.adj);
  const best = adjusted[0];
  if (!best) return { role: null, method: 'none', candidates: top3, reason: 'no-match' };
  const byId = new Map(all.map((r) => [r.id, r]));
  const tied = adjusted.filter((s) => s.adj === best.adj).map((s) => byId.get(s.id)!);
  // Specificity first (deeper in the tree, then the narrower description);
  // between interchangeable roles, the one with less open work.
  const spec = (r: PickableRole) => ({
    depth: depth(r, byId),
    breadth: new Set(matchTokens(`${r.title} ${(r.responsibilities ?? []).join(' ')}`)).size,
    load: load?.(r.id) ?? 0,
  });
  const ranked = tied
    .map((r) => ({ r, ...spec(r) }))
    .sort((a, b) => b.depth - a.depth || a.breadth - b.breadth || a.load - b.load);
  const [first, second] = ranked;
  if (
    second &&
    second.depth === first.depth &&
    second.breadth === first.breadth &&
    second.load === first.load
  )
    return { role: null, method: 'none', candidates: top3, reason: 'ambiguous' };
  return { role: first.r.id, method: 'keyword', score: best.score, candidates: top3 };
}

/** The role that should own a task: agent roles only, never the caller;
 *  Jev first (accepted answers only), then the keyword pick, which `history`
 *  (the org's finished tasks) biases toward roles that did well on similar
 *  ones. */
export async function pickTaskRole(
  task: TaskText,
  roles: PickableRole[],
  opts: PickOptions & {
    caller?: string;
    load?: (roleId: string) => number;
    history?: TaskOutcome[];
  } = {},
): Promise<RolePick> {
  const { caller, load, history, ...pickOpts } = opts;
  const candidates = agentRoles(roles).filter((r) => r.id !== caller);
  if (candidates.length === 0)
    return { role: null, method: 'none', candidates: [], reason: 'no-candidates' };
  if (candidates.length === 1)
    return { role: candidates[0].id, method: 'only', candidates: [{ id: candidates[0].id }] };
  const brief = task.brief?.slice(0, PICK_BRIEF_CHARS);
  const picked = await pickWithJev(
    brief ? `${task.title}\n\n${brief}` : task.title,
    { agents: roleCatalog(candidates) },
    {
      ...pickOpts,
      agentInstructions: 'Which role in this organisation should own this task?',
    },
  );
  const chosen = acceptAgent(picked?.agent, pickOpts.env);
  if (chosen && candidates.some((r) => r.id === chosen)) {
    return {
      role: chosen,
      method: 'jev',
      confidence: picked?.agent?.confidence,
      candidates: (picked?.agent?.ranked ?? [])
        .slice(0, 3)
        .map((r) => ({ id: r.id, score: r.probability })),
    };
  }
  return keywordRole(
    task,
    candidates,
    roles,
    load,
    history?.length ? roleOutcomePrior(task, history) : undefined,
  );
}

/** Up to `max` pool skills whose name/tags/description fit the task; those
 *  that clear MIN_SKILL_SCORE rank by score × `prior` (skillOutcomePrior). */
export function keywordSkills(
  task: TaskText,
  skills: { id: string; description?: string; text?: string }[],
  max = 2,
  prior?: (skill: string) => number,
): string[] {
  return scoreDocs(
    task,
    skills.map((s) => ({ id: s.id, strong: `${s.id} ${s.text ?? ''}`, weak: s.description ?? '' })),
  )
    .filter((s) => s.score >= MIN_SKILL_SCORE)
    .map((s, i) => ({ id: s.id, i, adj: s.score * (prior?.(s.id) ?? 1) }))
    .sort((a, b) => b.adj - a.adj || a.i - b.i)
    .slice(0, max)
    .map((s) => s.id);
}

/** Resolves `assignee: "auto"` on org_task (SessionOpts.pickAssignee).
 *  pickTaskRole (task-match.ts) falls back to a deterministic keyword match
 *  over role titles/responsibilities whenever no decision model answers, so
 *  this is wired unconditionally: gating it behind decisionModelConfigured()
 *  once left a literal "auto" assignee stranded as 'ready' forever
 *  (round1-issue1). Candidates are the agent roles other than the caller;
 *  `load` (open tasks per role) only breaks ties between interchangeable
 *  roles; `history` (the run's tasks) lets the keyword pick lean toward roles
 *  that finished similar tasks. */
export function resolveAutoAssignee(
  def: Pick<OrgDef, 'roles'>,
  load?: (roleId: string) => number,
  history?: () => TaskOutcome[],
): (title: string, brief?: string, caller?: string) => Promise<RolePick> {
  return (title: string, brief?: string, caller?: string) =>
    pickTaskRole({ title, brief }, def.roles, {
      caller,
      load,
      history: history?.(),
      onError: (err) =>
        process.stderr.write(
          `[org] decision model "${err.provider}" unavailable (${err.message})\n`,
        ),
    });
}
