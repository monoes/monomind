/**
 * Real-use pick eval: labelled examples from the hook logs of a project.
 * Every Task/Agent spawn whose prompt is on record (pick-adherence.jsonl
 * joined to route-outcomes.jsonl by routeId, or an older route record with
 * `agentActuallyUsed`) is one example: redacted prompt preview → the agent
 * actually spawned. `node scripts/pick-eval.mjs --logs` re-ranks the previews
 * with the current ranker; `monomind doctor -c pick` prints one summary line.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { redactPaths, redactSecrets } from '../utils/redaction.js';
import { type CatalogItem, keywordRank } from './jev.js';
import { EVAL_TOP, type EvalTask } from './pick-eval.js';

/** Only the newest part of a large log is read. */
export const MAX_LOG_BYTES = 4 * 1024 * 1024;
const PREVIEW_CHARS = 120;
/** Previews with fewer words say nothing a ranker can use ("continue"). */
const MIN_WORDS = 3;
/** Spawns before doctor reports a real-use agreement rate. */
export const REAL_USE_MIN_SPAWNS = 10;

type Rec = Record<string, unknown>;

/** Parsed JSONL records of a hook log (newest MAX_LOG_BYTES), [] when missing. */
export function readHookLog(file: string, maxBytes = MAX_LOG_BYTES): Rec[] {
  let fd: number | undefined;
  let lines: string[];
  try {
    const size = statSync(file).size;
    const length = Math.min(size, maxBytes);
    const buf = Buffer.alloc(length);
    fd = openSync(file, 'r');
    readSync(fd, buf, 0, length, size - length);
    lines = buf.toString('utf-8').split('\n');
    if (length < size) lines.shift(); // a partial first line
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const out: Rec[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === 'object' && !Array.isArray(rec)) out.push(rec);
    } catch {
      /* a torn line */
    }
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const SYSTEM_PREVIEW =
  /^(?:<(?:task-notification|system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook)\b|Caveat: |\[Request interrupted)/i;

/** A notification or harness message, not something a person asked for. */
export function isSystemPreview(text: string): boolean {
  return SYSTEM_PREVIEW.test(text.trimStart());
}

/** A record's prompt as a redacted, one-line preview of at most 120 chars.
 *  Older records carry `task` (up to 500 chars, not redacted by the hook). */
export function previewOf(rec: Rec): string {
  const raw = str(rec.promptPreview) ?? str(rec.task) ?? '';
  const text = raw.replace(/^\s*<pasted_content[^>]*>/i, '');
  return redactPaths(redactSecrets(text)).replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
}

export interface RealExample {
  routeId: string;
  preview: string;
  /** subagent_type of the spawn. */
  actual: string;
  /** The recorded pick at spawn time (null: none). */
  recommended: string | null;
  followed: boolean | null;
  /** The route printed a [PICK] line (null: older record without the field). */
  shown: boolean | null;
  method: string | null;
  /** Spawns of `actual` for this prompt. */
  spawns: number;
}

export interface RouteStats {
  routes: number;
  shown: number;
  /** Routes whose prompt was a notification or harness message. */
  system: number;
  methods: Record<string, number>;
  /** Most recommended agents over the non-system routes. */
  topRecommended: { name: string; count: number }[];
}

export interface RealUseLogs {
  hasAdherence: boolean;
  routes: RouteStats;
  /** Spawns on record (adherence lines with an agent, plus older joined routes). */
  spawns: number;
  /** Spawns made while a pick was recorded, and of those how many followed it. */
  recommendedSpawns: number;
  followed: number;
  /** The same, for spawns whose pick was shown as a [PICK] line. */
  shownSpawns: number;
  shownFollowed: number;
  examples: RealExample[];
  /** Spawns left out: notification prompt, too short, no prompt on record. */
  skipped: { system: number; short: number; noPrompt: number };
}

const normName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function routeStats(routes: Rec[]): RouteStats {
  const methods: Record<string, number> = {};
  // Keyed by normalized name: older records mix `Tester` and `tester`.
  const agents = new Map<string, { name: string; count: number }>();
  let system = 0;
  for (const r of routes) {
    const method = str(r.method) ?? str(r.routingMethod) ?? 'unknown';
    methods[method] = (methods[method] ?? 0) + 1;
    if (isSystemPreview(previewOf(r))) {
      system++;
      continue;
    }
    const agent = str(r.agentName) ?? str(r.recommendedAgent);
    if (!agent) continue;
    const entry = agents.get(normName(agent));
    if (entry) entry.count++;
    else agents.set(normName(agent), { name: agent, count: 1 });
  }
  return {
    routes: routes.length,
    shown: routes.filter((r) => r.shown === true).length,
    system,
    methods,
    topRecommended: [...agents.values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

/** `dir` is a .monomind directory, or a project root holding one. */
export function logsDir(dir: string): string {
  const nested = join(dir, '.monomind');
  return !existsSync(join(dir, 'route-outcomes.jsonl')) && existsSync(nested) ? nested : dir;
}

/** Labelled real-use examples and route stats from the hook logs in `dir`. */
export function readRealUse(dir: string): RealUseLogs {
  const d = logsDir(dir);
  const routes = readHookLog(join(d, 'route-outcomes.jsonl'));
  const adherenceFile = join(d, 'pick-adherence.jsonl');
  const adherence = readHookLog(adherenceFile);
  const byRoute = new Map<string, Rec>();
  for (const r of routes) {
    const id = str(r.routeId);
    if (id) byRoute.set(id, r); // the last record wins, as joinOutcome patches it
  }

  const out: RealUseLogs = {
    hasAdherence: existsSync(adherenceFile),
    routes: routeStats(routes),
    spawns: 0,
    recommendedSpawns: 0,
    followed: 0,
    shownSpawns: 0,
    shownFollowed: 0,
    examples: [],
    skipped: { system: 0, short: 0, noPrompt: 0 },
  };
  const examples = new Map<string, RealExample>();
  const spawn = (
    routeId: string | null,
    actual: string,
    recommended: string | null,
    followed: boolean | null,
  ): void => {
    out.spawns++;
    const route = routeId ? byRoute.get(routeId) : undefined;
    const shown = route && typeof route.shown === 'boolean' ? route.shown : null;
    if (followed !== null) {
      out.recommendedSpawns++;
      if (followed) out.followed++;
      if (shown) {
        out.shownSpawns++;
        if (followed) out.shownFollowed++;
      }
    }
    const preview = route ? previewOf(route) : '';
    if (!routeId || !route || !preview) out.skipped.noPrompt++;
    else if (isSystemPreview(preview)) out.skipped.system++;
    else if (preview.split(' ').length < MIN_WORDS) out.skipped.short++;
    else {
      const key = `${routeId}\u0000${actual}`;
      const seen = examples.get(key);
      if (seen) seen.spawns++;
      else
        examples.set(key, {
          routeId,
          preview,
          actual,
          recommended,
          followed,
          shown,
          method: str(route.method) ?? str(route.routingMethod),
          spawns: 1,
        });
    }
  };

  const spawnedRoutes = new Set<string>();
  for (const a of adherence) {
    const actual = str(a.actual);
    if (!actual) continue;
    const routeId = str(a.routeId);
    if (routeId) spawnedRoutes.add(routeId);
    spawn(routeId, actual, str(a.recommended), typeof a.followed === 'boolean' ? a.followed : null);
  }
  // Older logs: the spawn is only on the route record (agentActuallyUsed).
  for (const [routeId, r] of byRoute) {
    const actual = str(r.agentActuallyUsed);
    if (!actual || spawnedRoutes.has(routeId)) continue;
    const recommended = str(r.agentName) ?? str(r.recommendedAgent);
    spawn(
      routeId,
      actual,
      recommended,
      recommended ? normName(recommended) === normName(actual) : null,
    );
  }
  out.examples = [...examples.values()];
  return out;
}

/** The catalog id `name` refers to (by id or display name), or null. */
export function catalogId(name: string, agents: CatalogItem[]): string | null {
  const key = normName(name);
  const hit = agents.find((a) => normName(a.id) === key || normName(a.name ?? '') === key);
  return hit ? hit.id : null;
}

export interface RealUseScore {
  /** Examples whose spawned agent is in the catalog (the scored ones). */
  n: number;
  top1: number;
  top3: number;
  /** Examples that spawned an agent outside the catalog (e.g. general-purpose). */
  outOfCatalog: { name: string; count: number }[];
  /** In-catalog examples whose agent is not in the top 3, most spawns first. */
  disagreements: { preview: string; actual: string; got: string[]; spawns: number }[];
}

/** Score ranked agent ids (one list per example) against the spawned agents. */
export function scoreRealUse(
  examples: RealExample[],
  agents: CatalogItem[],
  picks: string[][],
): RealUseScore {
  const score: RealUseScore = { n: 0, top1: 0, top3: 0, outOfCatalog: [], disagreements: [] };
  const outside = new Map<string, number>();
  examples.forEach((ex, i) => {
    const id = catalogId(ex.actual, agents);
    if (!id) {
      outside.set(ex.actual, (outside.get(ex.actual) ?? 0) + 1);
      return;
    }
    score.n++;
    const got = (picks[i] ?? []).slice(0, EVAL_TOP);
    const at = got.indexOf(id);
    if (at === 0) score.top1++;
    if (at !== -1) score.top3++;
    else score.disagreements.push({ preview: ex.preview, actual: id, got, spawns: ex.spawns });
  });
  score.outOfCatalog = [...outside]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
  score.disagreements.sort((a, b) => b.spawns - a.spawns);
  return score;
}

/** Keyword-ranked agent ids for each example (in-process, no network). */
export function keywordRealPicks(examples: RealExample[], agents: CatalogItem[]): string[][] {
  return examples.map((ex) => keywordRank(ex.preview, agents, EVAL_TOP).map((a) => a.id));
}

/** In-catalog examples in the tests/pick-eval dataset shape, ids from `firstId`. */
export function realUseEvalTasks(
  examples: RealExample[],
  agents: CatalogItem[],
  firstId = 1001,
): EvalTask[] {
  const out: EvalTask[] = [];
  for (const ex of examples) {
    const id = catalogId(ex.actual, agents);
    if (id)
      out.push({
        id: firstId + out.length,
        domain: 'real-use',
        task: ex.preview,
        agents: [id],
        skills: [],
      });
  }
  return out;
}

const pct = (num: number, den: number): string =>
  den ? `${Math.round((100 * num) / den)}%` : 'n/a';

/** The `doctor -c pick` line for the project at `root`. */
export function realUseLine(root: string, agents: CatalogItem[]): string {
  const logs = readRealUse(join(root, '.monomind'));
  if (logs.spawns < REAL_USE_MIN_SPAWNS) return `real use: not enough spawns yet (${logs.spawns})`;
  const s = scoreRealUse(logs.examples, agents, keywordRealPicks(logs.examples, agents));
  return `real use: ${logs.spawns} spawns, followed ${pct(logs.followed, logs.recommendedSpawns)}, current ranker agrees ${pct(s.top3, s.n)} (top-3)`;
}
