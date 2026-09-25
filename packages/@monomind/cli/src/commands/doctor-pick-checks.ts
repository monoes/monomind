/**
 * Doctor — agent/skill picking (`doctor -c pick`). One row covering what
 * `monomind pick`, the MCP `pick` tool and the [PICK] hook line rank over:
 * the agent registry, the skill index, the decision model (configuration
 * only, no network), the keyword eval on the frozen tests/pick-eval set when
 * the project carries one, and adherence from the hook logs.
 *
 * Not part of the default doctor run: it rebuilds stale indexes and scores
 * the eval set, which a plain `doctor` should not spend time on.
 */
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot, registryIsStale, registryPath } from '../agents/registry-freshness.js';
import {
  agentCatalog,
  skillIndex,
  skillIndexIsStale,
  taskSkillCatalog,
} from '../decision/catalogs.js';
import { jevModule } from '../decision/jev.js';
import {
  formatScore,
  keywordEval,
  readEvalSnapshot,
  readEvalTasks,
} from '../decision/pick-eval.js';
import { readPickStats } from '../decision/pick-stats.js';
import type { HealthCheck } from './doctor-env-checks.js';

const NAME = 'Agent/Skill Picking';
/** Only the newest part of a large log is read. */
const MAX_LOG_BYTES = 4 * 1024 * 1024;

export interface PickAdherence {
  /** Picks the prompt hook recorded (route-outcomes.jsonl). */
  routes: number;
  /** Of those, how many were shown as a [PICK] line. */
  shown: number;
  /** Task/Agent spawns made while a pick was on record (pick-adherence.jsonl). */
  spawns: number;
  /** Of those, how many used the picked agent. */
  followed: number;
}

function tailLines(file: string): string[] {
  let fd: number | undefined;
  try {
    const size = statSync(file).size;
    const length = Math.min(size, MAX_LOG_BYTES);
    const buf = Buffer.alloc(length);
    fd = openSync(file, 'r');
    readSync(fd, buf, 0, length, size - length);
    const lines = buf.toString('utf-8').split('\n');
    if (length < size) lines.shift(); // a partial first line
    return lines.filter(Boolean);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function records(file: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of tailLines(file)) {
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === 'object') out.push(rec);
    } catch {
      /* a torn line */
    }
  }
  return out;
}

/**
 * Route and adherence counts straight from the hook logs, so doctor reports
 * them even where the pick-stats helper is not installed. Outcome rates come
 * from readPickStats.
 */
export function readPickAdherence(root: string): PickAdherence {
  const dir = join(root, '.monomind');
  const routes = records(join(dir, 'route-outcomes.jsonl'));
  const spawns = records(join(dir, 'pick-adherence.jsonl')).filter(
    (r) => typeof r.followed === 'boolean',
  );
  return {
    routes: routes.length,
    shown: routes.filter((r) => r.shown === true).length,
    spawns: spawns.length,
    followed: spawns.filter((r) => r.followed === true).length,
  };
}

/** What the registry file holds: every agent (deprecated included) and slug clashes. */
function registryCounts(root: string): { total: number; deprecated: number; duplicates: number } {
  try {
    const reg = JSON.parse(readFileSync(registryPath(root), 'utf-8'));
    const agents: { deprecated?: unknown }[] = Array.isArray(reg.agents) ? reg.agents : [];
    return {
      total: agents.length,
      deprecated: agents.filter((a) => a?.deprecated === true).length,
      duplicates: Array.isArray(reg.duplicates) ? reg.duplicates.length : 0,
    };
  } catch {
    return { total: 0, deprecated: 0, duplicates: 0 };
  }
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function checkPick(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<HealthCheck> {
  const root = findProjectRoot(cwd) ?? cwd;
  const lines: string[] = [];
  const problems: string[] = [];
  const fixes: string[] = [];

  const registryWasStale = registryIsStale(root);
  const agents = agentCatalog(root); // rebuilds a stale registry
  // Picks rank the non-deprecated agents; the registry file holds them all.
  const reg = registryCounts(root);
  const dupes = reg.duplicates;
  const hidden = Math.max(0, reg.total - agents.length);
  const hiddenNote = hidden
    ? ` (${hidden} hidden: ${hidden === reg.deprecated ? 'deprecated' : `${reg.deprecated} deprecated, ${hidden - reg.deprecated} other`})`
    : '';
  const userAgents = agents.filter((a) => a.origin === 'user').length;
  lines.push(
    `registry: ${plural(agents.length, 'pickable agent')} of ${reg.total} registered${hiddenNote}, ${userAgents} from ~/.claude/agents, ${plural(dupes, 'duplicate')}, ${registryWasStale ? 'was stale (rebuilt)' : 'fresh'}`,
  );
  if (agents.length === 0) {
    problems.push('no agents to pick from');
    fixes.push('monomind init  (installs agent definitions)');
  }
  if (dupes > 0) {
    problems.push('duplicate agent slugs');
    fixes.push('Give each duplicated agent a unique `slug:` (see `doctor -c registry`)');
  }

  const indexWasStale = skillIndexIsStale(root);
  const index = skillIndex(root) as { skills?: { origin?: string }[] } | undefined;
  const skills = taskSkillCatalog(root);
  const user = (index?.skills ?? []).filter((s) => s.origin === 'user').length;
  const org = skills.filter((s) => s.source === 'org').length;
  // User skills (~/.claude/skills) sit in the platform pool.
  const platform = Math.max(0, skills.length - org - user);
  const freshness =
    indexWasStale === undefined
      ? 'builder missing'
      : indexWasStale
        ? 'was stale (rebuilt)'
        : 'fresh';
  // The index lists commands and skills separately; picks count a
  // command/skill pair once, so the two numbers differ.
  const indexed = index?.skills?.length ?? 0;
  lines.push(
    `skills: ${skills.length} pickable (${platform} platform, ${org} org, ${user} user); skill index holds ${indexed} ${indexed === 1 ? 'entry' : 'entries'}, ${freshness}`,
  );
  if (skills.length === 0) {
    problems.push('no skills to pick from');
    fixes.push('monomind init  (installs skills)');
  }

  const providers = jevModule()?.resolveProviders(env) ?? [];
  lines.push(
    providers.length
      ? `decision model: configured (${providers.map((p) => p.name).join(' → ')}); probe with \`doctor -c jev\``
      : 'decision model: not configured (keyword ranking)',
  );

  const tasks = readEvalTasks(root);
  const snapshot = readEvalSnapshot(root);
  if (tasks && snapshot) {
    const r = keywordEval(tasks, snapshot);
    lines.push(
      `eval (frozen catalog, keyword): agents ${formatScore(r.agents)} · skills ${formatScore(r.skills)}`,
    );
  } else lines.push('eval: no tests/pick-eval set in this project (monomind source checkout only)');

  const a = readPickAdherence(root);
  if (a.routes === 0 && a.spawns === 0) lines.push('adherence: no picks logged yet');
  else {
    const rate = a.spawns ? ` (${Math.round((100 * a.followed) / a.spawns)}%)` : '';
    lines.push(
      `adherence: ${a.routes} routes, ${a.shown} shown; spawns followed the pick ${a.followed}/${a.spawns}${rate}`,
    );
  }
  const s = readPickStats(root);
  const pct = (v: number | null): string => (v === null ? 'n/a' : `${Math.round(100 * v)}%`);
  if (s.followedSuccessRate !== null || s.notFollowedSuccessRate !== null)
    lines.push(
      `outcomes: subagent success ${pct(s.followedSuccessRate)} when the pick was followed, ${pct(s.notFollowedSuccessRate)} when overridden`,
    );

  const message = lines.join('\n  ');
  return problems.length
    ? {
        name: NAME,
        status: 'warn',
        message: `${problems.join('; ')}\n  ${message}`,
        fix: fixes.join('; '),
      }
    : { name: NAME, status: 'pass', message };
}
