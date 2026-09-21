// What an Org Runtime v2 org is doing, for the dashboard's Runtime pane,
// assembled from the runtime's own sources rather than the dashboard's
// derived files:
//   - the live daemon's /api/status (roles, task DAG) when the org runs —
//     read with the org's AGENT credential, which authorizes no decision;
//   - <org>/runtime.json (last run, checkpointed task DAG) when it doesn't;
//   - <org>/<run>/bus.jsonl (per-role usage incl. cache tokens, and the
//     evidence-gate / idle-watchdog audit trail);
//   - <org>/idle-watchdog.json (the idle clock and its hold deadline);
//   - <org>/history.jsonl (how each run actually ended);
//   - the org definition, resolved through cost_tiers like session.ts does.
import fs from 'node:fs';
import path from 'node:path';
import { resolveRoleCostTier, validateCostTiers } from '../orgrt/cost-tier.js';
import { readIdleStatus } from '../orgrt/idle-deadline.js';
import { OrgDefSchema } from '../orgrt/types.js';
import { hostingDaemon, writeFileAtomic } from './org-hil.mjs';

const orgDir = (root, org) => path.join(root, '.monomind', 'orgs', org);

/** Reasons the Runtime pane lists: the completion-evidence gate, the idle
 *  watchdog, org_complete refusals and role failures. The runtime emits some
 *  as 'audit' events and some (budget exhaustion, agent-fatal, loadout
 *  mismatch) as 'status' events, so both types are read. */
export const RUNTIME_AUDIT_REASONS = new Set([
  'task-evidence-refused',
  'task-evidence-escalated',
  'org-complete-refused',
  'idle-nudge',
  'idle-stop',
  'no-progress',
  'hold-expired',
  'circuit-breaker-tripped',
  'budget-exhausted',
  'org-budget-exhausted',
  'agent-fatal',
  'worker-crashed',
  'session-result-error',
  'loadout-unresolvable',
  'loadout-mismatch',
  'agent-session-crash',
  'agent-context-limit',
  'boss-context-limit',
]);
const MAX_AUDIT = 60;

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const zeroUsage = () => ({
  tokens: 0,
  tokens_in: 0,
  tokens_out: 0,
  cache_read: 0,
  cache_creation: 0,
  cost_usd: 0,
  turns: 0,
  // Tokens from usage events recorded before the four-way split (ADR-O001
  // D1). Their `tokens` counted input + output only — no cache — so they add
  // to the uncached figure and leave the billable one unknown.
  legacy_tokens: 0,
});

// A run's bus.jsonl reaches tens of MB; parse each version once.
const runCache = new Map();

/** Per-role usage, last activity and the runtime audit trail of one run. */
export function readRunDigest(root, org, run) {
  const file = path.join(orgDir(root, org), run, 'bus.jsonl');
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = runCache.get(file);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.digest;
  const usage = {};
  const lastActivity = {};
  const audit = [];
  let startedAt = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (startedAt === null && typeof e.ts === 'number') startedAt = e.ts;
    if (e.from && typeof e.ts === 'number') lastActivity[e.from] = e.ts;
    if (e.type === 'usage' && e.from) {
      const u = (usage[e.from] ??= zeroUsage());
      const d = e.data ?? {};
      if (d.tokens_in === undefined) {
        u.legacy_tokens += Number(d.tokens) || 0;
        u.cost_usd += Number(d.cost_usd) || 0;
        u.turns += 1;
        continue;
      }
      u.tokens += Number(d.tokens) || 0;
      u.tokens_in += Number(d.tokens_in) || 0;
      u.tokens_out += Number(d.tokens_out) || 0;
      u.cache_read += Number(d.cache_read) || 0;
      u.cache_creation += Number(d.cache_creation) || 0;
      u.cost_usd += Number(d.cost_usd) || 0;
      u.turns += 1;
    } else if ((e.type === 'audit' || e.type === 'status') && RUNTIME_AUDIT_REASONS.has(e.reason)) {
      audit.push({
        ts: e.ts,
        reason: e.reason,
        from: e.from ?? null,
        msg: e.msg ?? '',
        data: e.data ?? null,
      });
      if (audit.length > MAX_AUDIT) audit.shift();
    }
  }
  const digest = { startedAt, usage, lastActivity, audit: audit.reverse() };
  runCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, digest });
  return digest;
}

/** The live daemon's status for `org`, or null when no daemon hosts it for
 *  `root` (a same-named org in another project is not this one). */
async function liveStatus(root, org) {
  const entry = hostingDaemon(root, org);
  if (!entry) return null;
  try {
    const res = await fetch(`${entry.url}/api/status`, {
      headers: entry.credential ? { 'x-monomind-cred': entry.credential } : {},
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { unreachable: `daemon answered ${res.status}` };
    const snap = await res.json();
    return (
      (snap.orgs || []).find((o) => o.name === org) ?? {
        unreachable: 'daemon does not list this org',
      }
    );
  } catch (err) {
    return { unreachable: err.message };
  }
}

/** Last `n` history.jsonl entries, newest first, trimmed to what a run
 *  outcome needs (`closedBy` before `outcome` — see reporting.ts). */
export function readRecentHistory(root, org, n = 10) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(orgDir(root, org), 'history.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n').filter(Boolean).slice(-n).reverse()) {
    try {
      const h = JSON.parse(line);
      out.push({
        run: h.run,
        startedAt: h.startedAt ?? null,
        endedAt: h.endedAt ?? null,
        durationMs: h.durationMs ?? null,
        closedBy: h.closedBy ?? null,
        outcome: h.outcome ?? null,
        blocker: h.blocker ?? null,
        blockerDetail: h.blockerDetail ?? null,
        runnableTasksAtStop: h.runnableTasksAtStop ?? 0,
        crashes: h.crashes ?? [],
        totalTokens: h.totalTokens ?? 0,
        totalCostUsd: h.totalCostUsd ?? 0,
      });
    } catch {
      /* one bad line doesn't hide the rest */
    }
  }
  return out;
}

/** Model and effort a role runs with, with where each came from. Mirrors
 *  session.ts: an explicit adapter_config.model beats the tier's model; the
 *  tier's effort applies either way. */
export function describeRoleModel(role, def) {
  let tier = null;
  let tierError = null;
  try {
    tier = resolveRoleCostTier({ role, def }) ?? null;
  } catch (err) {
    tierError = err.message;
  }
  const explicit = role.adapter_config?.model || null;
  return {
    runtime: role.runtime ?? def.runtime ?? 'claude',
    model: explicit ?? tier?.model ?? null,
    modelSource: explicit ? 'adapter_config' : tier ? 'tier' : 'runtime default',
    effort: tier?.effort ?? null,
    tier: tier?.tier ?? null,
    tierError,
  };
}

export async function runtimeView(root, org) {
  const raw = readJson(path.join(root, '.monomind', 'orgs', `${org}.json`));
  if (!raw) return null;
  const parsed = OrgDefSchema.safeParse(raw);
  // Defaults (run_config) come from the schema; an invalid definition still
  // renders, with the problems listed.
  const def = parsed.success ? parsed.data : { ...raw, run_config: raw.run_config ?? {} };
  const rc = def.run_config ?? {};
  const runtime = readJson(path.join(orgDir(root, org), 'runtime.json'));
  const live = await liveStatus(root, org);
  const isLive = !!(live && !live.unreachable);
  const run = (isLive ? live.run : null) ?? runtime?.run ?? null;
  const digest = run ? readRunDigest(root, org, run) : null;
  const liveRoles = new Map((isLive ? live.roles : []).map((r) => [r.id, r]));
  const pendingRoles = new Set(isLive ? live.pendingRoles : []);

  const roles = (def.roles || []).map((r) => {
    const lr = liveRoles.get(r.id);
    return {
      id: r.id,
      title: r.title || r.id,
      reportsTo: r.reports_to ?? null,
      ...describeRoleModel(r, def),
      status: lr?.status ?? (pendingRoles.has(r.id) ? 'not started' : isLive ? 'idle' : 'stopped'),
      usage: digest?.usage[r.id] ?? zeroUsage(),
      lastActivity: digest?.lastActivity[r.id] ?? null,
    };
  });
  const totals = roles.reduce((t, r) => {
    for (const k of Object.keys(t)) t[k] += r.usage[k];
    return t;
  }, zeroUsage());
  const basis = rc.budget_tokens_basis ?? 'uncached';

  return {
    org,
    valid: parsed.success,
    problems: parsed.success
      ? []
      : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    live: isLive,
    liveError: live?.unreachable ?? null,
    run,
    status: isLive ? 'running' : (runtime?.status ?? 'never run'),
    closedBy: isLive ? null : (runtime?.closedBy ?? null),
    startedAt: digest?.startedAt ?? null,
    updated: runtime?.updated ?? null,
    idle: isLive && run ? readIdleStatus(root, org, run) : null,
    settings: {
      completion: rc.completion ?? 'boss',
      completion_evidence: !!rc.completion_evidence,
      max_evidence_attempts: rc.max_evidence_attempts ?? 3,
      idle_minutes: rc.idle_minutes ?? 10,
      session_scope: rc.session_scope ?? 'role',
      workspace: rc.workspace ?? 'repo',
      max_concurrent_agents: rc.max_concurrent_agents ?? 4,
    },
    budget: {
      tokens: rc.budget_tokens ?? null,
      basis,
      // Enforcement counts cache tokens only on 'billable'. Pre-split usage
      // (legacy_tokens) is uncached, so it leaves a billable total unknown.
      used:
        basis === 'billable'
          ? totals.legacy_tokens > 0
            ? null
            : totals.tokens
          : totals.tokens_in + totals.tokens_out + totals.legacy_tokens,
    },
    totals,
    roles,
    tasks: (isLive ? live.tasks : runtime?.checkpoint?.tasks) ?? [],
    audit: digest?.audit ?? [],
    history: readRecentHistory(root, org),
  };
}

/** run_config keys the dashboard's Config tab may set. Everything else in the
 *  definition is left exactly as it is on disk. */
const EDITABLE_RUN_CONFIG = new Set([
  'max_concurrent_agents',
  'budget_tokens',
  'budget_tokens_basis',
  'idle_minutes',
  'completion',
  'completion_evidence',
  'max_evidence_attempts',
  'session_scope',
  'workspace',
  'memory_namespace',
  'max_turns_per_message',
]);

export class ConfigRejected extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

/** Apply `patch` ({ goal?, schedule?, run_config?, cost_tiers_default? }) to
 *  the org definition on disk and write it only if the result passes the same
 *  OrgDefSchema parse (and cost-tier check) `org run` performs. A `null`
 *  run_config value removes that key, so the runtime default applies. Returns
 *  the definition as written. */
export function patchOrgConfig(root, org, patch) {
  const file = path.join(root, '.monomind', 'orgs', `${org}.json`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ConfigRejected([`cannot read ${file}: ${err.message}`]);
  }
  const problems = [];
  const next = { ...raw };
  if (patch.goal !== undefined) {
    if (typeof patch.goal === 'string') next.goal = patch.goal;
    else problems.push('goal must be a string');
  }
  if (patch.schedule !== undefined) next.schedule = patch.schedule === '' ? null : patch.schedule;
  if (patch.run_config !== undefined) {
    const rc = { ...(raw.run_config ?? {}) };
    for (const [k, v] of Object.entries(patch.run_config ?? {})) {
      if (!EDITABLE_RUN_CONFIG.has(k)) {
        problems.push(`run_config.${k} is not editable here`);
        continue;
      }
      if (v === null) delete rc[k];
      else rc[k] = v;
    }
    next.run_config = rc;
  }
  if (patch.cost_tiers_default !== undefined) {
    const ct = { ...(raw.cost_tiers ?? {}) };
    if (patch.cost_tiers_default) ct.default = String(patch.cost_tiers_default);
    else delete ct.default;
    if (Object.keys(ct).length) next.cost_tiers = ct;
    else delete next.cost_tiers;
  }
  if (problems.length) throw new ConfigRejected(problems);
  const parsed = OrgDefSchema.safeParse(next);
  if (!parsed.success)
    throw new ConfigRejected(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  const tierProblems = validateCostTiers(parsed.data);
  if (tierProblems.length) throw new ConfigRejected(tierProblems);
  writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
