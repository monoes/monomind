// tests/eval/org/smoke/lib.mjs
//
// Shared steps of the smoke tier's trial preparation (org sections spec 10): the
// two contenders, the one model every role runs on, per-role soft caps within
// the scenario's planning allocation, and trial isolation. A scenario kit
// (scenarios/<id>/kit.mjs) supplies only its base org definition, task, inputs
// and checker; everything that must be identical across scenarios and
// contenders lives here so it cannot drift between them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every role runs on Haiku 4.5: priced, so the USD soft stops and the cost
 *  comparison stay valid (codex and antigravity report tokens but no USD). */
export const MODEL = 'claude-haiku-4-5-20251001';

/** The two contenders of a smoke run (spec 10, "the candidate and the current best"):
 *  - current-best: the Phase 0 configuration: task-scoped sessions, no context surface.
 *  - phase2: current-best plus the Phase 2 surface: required briefs, notes, a session cap. */
export const CONTENDERS = ['current-best', 'phase2'];

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** The contender's run_config on top of a scenario's base definition. `sessionCap`
 *  is the scenario's own value, fixed in its kit before any run. */
export function applyContender(def, contender, { sessionCap } = {}) {
  if (!CONTENDERS.includes(contender))
    throw new Error(`contender must be one of ${CONTENDERS.join(', ')}`);
  const out = structuredClone(def);
  out.run_config = { ...(out.run_config ?? {}), session_scope: 'task' };
  delete out.run_config.context;
  if (contender === 'phase2') {
    if (!sessionCap || (sessionCap.tokens === undefined && sessionCap.tasks === undefined))
      throw new Error(
        "the phase2 contender needs the scenario's session cap ({tokens} or {tasks})",
      );
    out.run_config.context = { require_brief: true, notes: true, session_cap: sessionCap };
  }
  return out;
}

/** Which runner and model each scenario's worker roles use, identical in both contenders.
 *  The root role always stays on Claude Haiku: it coordinates through the native org tools
 *  and is the priced anchor of every run. codex and antigravity report tokens, not USD, so a
 *  scenario using them is capped by tokens (UNPRICED_ROLE_TOKENS) and its cost is reported
 *  as incomplete, never as zero.
 *  - research-report: a stronger reader for verbatim citations (codex, the higher model).
 *  - deliberative-design: breadth of reasoning across deliberators (antigravity, the higher flash model).
 *  - sparse-dispatch: the steward depends on the native notes tool and rotation (Claude, priced).
 *  - dev-feature-qa: read-only QA is enforced through Claude's file and sandbox restrictions, which
 *    the other runners are not verified to honour (Claude, priced). */
export const CLAUDE = { runtime: 'claude', model: MODEL };
export const CODEX = { runtime: 'codex', model: 'gpt-6-astra' };
export const AGY = { runtime: 'antigravity', model: 'gemini-3.8-flash-high' };
export const RUNNER_PLANS = {
  'research-report': { workers: CODEX },
  'deliberative-design': { workers: AGY },
  'sparse-dispatch': { workers: CLAUDE },
  'dev-feature-qa': { workers: CLAUDE },
  'growth-like': { workers: CLAUDE },
  _selftest: { workers: CLAUDE },
};

/** Soft token cap for each role on an unpriced runner, and for the org as a whole. */
export const UNPRICED_ROLE_TOKENS = 500_000;
export const ORG_TOKENS = 4_000_000;

const isRoot = (r) => r.reports_to == null;
export const planFor = (role, plan) => (isRoot(role) ? CLAUDE : plan.workers);
export const isUnpriced = (runner) => runner.runtime !== 'claude';

/** Pin every role to its scenario's runner and model; the root role is Claude Haiku. */
export function applyModel(def, plan = { workers: CLAUDE }) {
  const out = structuredClone(def);
  for (const r of out.roles) {
    const p = planFor(r, plan);
    r.adapter_config = { ...(r.adapter_config ?? {}), model: p.model };
    delete r.provider;
    if (p.runtime === 'claude') delete r.runtime;
    else r.runtime = p.runtime;
  }
  return out;
}

/** The runner and model each role ended up on, for the trial record and the report. */
export function runnersOf(def) {
  return Object.fromEntries(
    def.roles.map((r) => [
      r.id,
      { runtime: r.runtime ?? 'claude', model: r.adapter_config?.model },
    ]),
  );
}

/** Soft stops: USD per priced role, summing to no more than the scenario's planning
 *  allocation; a token cap per role on an unpriced runner (which reports no USD); and one
 *  org-wide token cap, the same in every trial so no default decides a result. */
export function applyCaps(def, caps, allocationUsd) {
  const out = structuredClone(def);
  let usd = 0;
  for (const r of out.roles) {
    if (!(r.id in caps)) throw new Error(`role ${r.id} has no cap`);
    if (isUnpriced({ runtime: r.runtime ?? 'claude' })) r.budget_tokens = UNPRICED_ROLE_TOKENS;
    else {
      r.budget_usd = caps[r.id];
      usd += caps[r.id];
    }
  }
  for (const id of Object.keys(caps))
    if (!out.roles.some((r) => r.id === id)) throw new Error(`cap for unknown role ${id}`);
  if (usd > allocationUsd + 1e-9)
    throw new Error(`role caps sum to $${usd}, over the $${allocationUsd} planning allocation`);
  out.run_config = { ...(out.run_config ?? {}), budget_tokens: ORG_TOKENS };
  return out;
}

/** A trial's own definition: renamed, unscheduled, pointed at its own workspace,
 *  and unable to write the immutable inputs or anything else in `denyWrite`. */
export function isolate(def, { name, workspace, denyWrite = [] }) {
  const out = structuredClone(def);
  out.name = name;
  delete out.schedule;
  out.run_config = { ...(out.run_config ?? {}), workspace };
  for (const r of out.roles) {
    r.policy ??= {};
    r.policy.sandbox = {
      ...(r.policy.sandbox ?? {}),
      denyWrite: [...(r.policy.sandbox?.denyWrite ?? []), ...denyWrite],
    };
  }
  return out;
}

/** The dotted paths at which two values differ (the trial's effective configuration diff). */
export function effectiveDiff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
      effectiveDiff(a[k], b[k], path ? `${path}.${k}` : k),
    );
  }
  return [path];
}

export const trialName = (scenario, contender, n) => `smoke-${scenario}-${contender}-${n}`;

/** A fresh trial root; refuses to reuse one. */
export function newRoot(base, name) {
  const root = join(base, 'trials', name);
  if (existsSync(root)) throw new Error(`${root} exists; every trial starts from a fresh root`);
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  return root;
}
