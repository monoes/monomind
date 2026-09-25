/**
 * Doctor — agent/skill picking (`doctor -c pick`). One row covering what
 * `monomind pick`, the MCP `pick` tool and the [PICK] hook line rank over:
 * the agent registry, the skill index, the decision model (configuration
 * only, no network), the keyword eval on the frozen tests/pick-eval set when
 * the project carries one, and adherence from the hook logs.
 *
 * Not part of the default doctor run: it rebuilds stale indexes and scores
 * the eval set, which a plain `doctor` should not spend time on.
 * The real-use line re-ranks logged prompts that led to a spawn
 * (decision/pick-real.ts; `pick-eval.mjs --logs` has the full report).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
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
import { readHookLog, realUseLine } from '../decision/pick-real.js';
import { readPickStats } from '../decision/pick-stats.js';
import { VERSION } from '../index.js';
import type { HealthCheck } from './doctor-env-checks.js';

const NAME = 'Agent/Skill Picking';

export interface PickAdherence {
  /** Picks the prompt hook recorded (route-outcomes.jsonl), slash commands left out. */
  routes: number;
  /** Of those, how many were shown as a [PICK] line. */
  shown: number;
  /** Picks on record when a Task/Agent spawn was made (pick-adherence.jsonl),
   *  each route once however many spawns it had. */
  spawns: number;
  /** Of those, how many had a spawn of the picked agent. */
  followed: number;
}

/** A prompt that is a slash command (the route hook's rule): not a pick. */
const COMMAND_PROMPT = /^\/[a-z0-9_-]+(:[a-z0-9_-]+)*(\s|$)/i;

/**
 * Route and adherence counts straight from the hook logs, so doctor reports
 * them even where the pick-stats helper is not installed. Outcome rates come
 * from readPickStats.
 */
export function readPickAdherence(root: string): PickAdherence {
  const dir = join(root, '.monomind');
  const logged = readHookLog(join(dir, 'route-outcomes.jsonl'));
  const commands = new Set(
    logged
      .filter((r) => COMMAND_PROMPT.test(String(r.promptPreview ?? r.task ?? '').trim()))
      .map((r) => r.routeId),
  );
  const routes = logged.filter((r) => !commands.has(r.routeId));
  // One outcome per route: followed when any of its spawns used the pick.
  const byRoute = new Map<unknown, boolean>();
  let unkeyed = 0;
  for (const r of readHookLog(join(dir, 'pick-adherence.jsonl'))) {
    if (typeof r.followed !== 'boolean' || commands.has(r.routeId)) continue;
    if (!r.routeId) byRoute.set(unkeyed++, r.followed);
    else byRoute.set(r.routeId, byRoute.get(r.routeId) === true || r.followed);
  }
  return {
    routes: routes.length,
    shown: routes.filter((r) => r.shown === true).length,
    spawns: byRoute.size,
    followed: [...byRoute.values()].filter(Boolean).length,
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
      `adherence: ${a.routes} routes, ${a.shown} shown; picks followed by a spawn of the picked agent ${a.followed}/${a.spawns}${rate}`,
    );
  }
  lines.push(realUseLine(root, agents));
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

// ── The running MCP server (`doctor -c mcp-running`) ─────────────────────────
//
// Claude Code starts its MCP servers once per session and keeps them until it
// restarts. After an upgrade the helpers suggest tools (org_skill_show) the
// still-running older server does not have. A server cannot be asked its
// version from outside its stdio pipe, so this reads what is discoverable:
// the `monomind … mcp start` processes (`ps`), the package their script
// belongs to (its package.json version and mtime), and on Linux their working
// directory (/proc/<pid>/cwd) to keep this project's servers. Limits: a
// package replaced in place is caught by its mtime, not by the code the
// process loaded; without /proc (macOS) every project's servers count; on
// Windows nothing is checked.

export interface McpServerProcess {
  pid: number;
  /** Epoch ms the process started. */
  startedAt: number;
  /** The script node runs (resolved through symlinks when possible). */
  script: string;
  /** The process's working directory, when the platform exposes it. */
  cwd?: string;
}

const CLI_PACKAGES = new Set(['@monoes/monomindcli', 'monomind']);

/** `[[dd-]hh:]mm:ss` (ps etime) as seconds; NaN when it does not parse. */
function etimeSeconds(etime: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!m) return Number.NaN;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4]);
}

/** Running `… monomind … mcp start` node processes (POSIX `ps`). */
export function listMcpServerProcesses(now: number = Date.now()): McpServerProcess[] {
  if (process.platform === 'win32') return [];
  let out = '';
  try {
    out = execFileSync('ps', ['-axo', 'pid=,etime=,args='], { encoding: 'utf-8', timeout: 3000 });
  } catch {
    return [];
  }
  const found: McpServerProcess[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m || !/\bmcp\s+start\b/.test(m[3])) continue;
    // The script is the first argument that is a file of this CLI.
    const script = m[3]
      .split(/\s+/)
      .slice(1)
      .find((a) => /monomind/.test(a) && existsSync(a));
    if (!script) continue;
    const pid = Number(m[1]);
    let cwd: string | undefined;
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      /* no /proc */
    }
    let real = script;
    try {
      real = realpathSync(script);
    } catch {
      /* keep the path as given */
    }
    found.push({
      pid,
      startedAt: now - etimeSeconds(m[2]) * 1000,
      script: real,
      ...(cwd ? { cwd } : {}),
    });
  }
  return found.filter((p) => Number.isFinite(p.startedAt));
}

/** The CLI package a server script belongs to: version and install time. */
function serverPackage(script: string): { version: string; installedAt: number } | null {
  let dir = dirname(script);
  for (let i = 0; i < 6; i++) {
    const file = join(dir, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf-8')) as { name?: string; version?: string };
      if (pkg.name && CLI_PACKAGES.has(pkg.name) && typeof pkg.version === 'string')
        return { version: pkg.version, installedAt: statSync(file).mtimeMs };
    } catch {
      /* not here */
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export async function checkRunningMcpServer(
  cwd: string = process.cwd(),
  deps: { processes?: () => McpServerProcess[]; now?: number; version?: string } = {},
): Promise<HealthCheck> {
  const name = 'MCP Server Version';
  const now = deps.now ?? Date.now();
  const version = deps.version ?? VERSION;
  if (!deps.processes && process.platform === 'win32')
    return { name, status: 'pass', message: 'not checked on Windows' };
  const root = resolve(findProjectRoot(cwd) ?? cwd);
  const mine = (deps.processes ?? (() => listMcpServerProcesses(now)))().filter(
    (p) => !p.cwd || p.cwd === root || p.cwd.startsWith(root + sep),
  );
  if (mine.length === 0)
    return { name, status: 'pass', message: `no running monomind MCP server found for ${root}` };
  const stale: string[] = [];
  const current: string[] = [];
  for (const p of mine) {
    const pkg = serverPackage(p.script);
    if (!pkg) current.push(`pid ${p.pid} (version unknown)`);
    else if (pkg.version !== version)
      stale.push(`pid ${p.pid} runs v${pkg.version}, this CLI is v${version}`);
    else if (pkg.installedAt > p.startedAt)
      stale.push(`pid ${p.pid}: v${pkg.version} was updated after it started`);
    else current.push(`pid ${p.pid} v${pkg.version}`);
  }
  if (stale.length === 0) return { name, status: 'pass', message: current.join('; ') };
  return {
    name,
    status: 'warn',
    message: `a running MCP server predates this install (${stale.join('; ')}): tools the hooks suggest, such as org_skill_show, may be missing`,
    fix: 'Restart Claude Code (or reconnect monomind in /mcp) to load the current server; until then read an Org skill with `npx -y monomind org skills show <name>`',
  };
}
