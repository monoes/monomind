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

/** The null hypothesis (spec R18), kept as a third arm where a scenario asks for it: the Phase 2
 *  configuration with one role, the root, doing the whole task alone, on the same model and the same
 *  org-wide stop. It is not in CONTENDERS, so a smoke run still loops over the two. */
export const SOLO = 'single';

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** The contender's run_config on top of a scenario's base definition. `sessionCap`
 *  is the scenario's own value, fixed in its kit before any run. */
export function applyContender(def, contender, { sessionCap } = {}) {
  if (![...CONTENDERS, SOLO].includes(contender))
    throw new Error(`contender must be one of ${[...CONTENDERS, SOLO].join(', ')}`);
  const out = structuredClone(def);
  out.run_config = { ...(out.run_config ?? {}), session_scope: 'task' };
  delete out.run_config.context;
  if (contender === 'phase2' || contender === SOLO) {
    if (!sessionCap || (sessionCap.tokens === undefined && sessionCap.tasks === undefined))
      throw new Error(
        "the phase2 contender needs the scenario's session cap ({tokens} or {tasks})",
      );
    out.run_config.context = { require_brief: true, notes: true, session_cap: sessionCap };
  }
  if (contender === SOLO) {
    const root = out.roles.find((r) => r.reports_to == null) ?? out.roles[0];
    out.roles = [root];
  }
  return out;
}

/** Which runner and model each scenario's worker roles use, identical in both contenders.
 *  The root role always stays on Claude Haiku: it coordinates through the native org tools
 *  and is the priced anchor of every run. codex and antigravity report tokens, not USD, so a
 *  scenario using them is capped by tokens (UNPRICED_ROLE_TOKENS) and its cost is reported
 *  as incomplete, never as zero.
 *  - research-report: a stronger reader for verbatim citations (codex, the higher model).
 *  - deliberative-design: codex too. It first ran on antigravity (dry run): the advocate's org_send
 *    carried the whole scoring table in one tool-call fence, the fence was malformed JSON ("Unterminated
 *    string"), the runtime ignored it, and the org sat silent until the idle watchdog ended it with
 *    no deliverable. That is the runner's fence parsing, not the question, so it gives no quality read.
 *  - sparse-dispatch: the steward depends on the native notes tool and rotation (Claude, priced).
 *  - dev-feature-qa: read-only QA is enforced through Claude's file and sandbox restrictions, which
 *    the other runners are not verified to honour (Claude, priced). */
export const CLAUDE = { runtime: 'claude', model: MODEL };
export const CODEX = { runtime: 'codex', model: 'gpt-6-astra' };
export const AGY = { runtime: 'antigravity', model: 'gemini-3.8-flash-high' };
export const SONNET = 'claude-sonnet-5-5';

/** Profiles: `haiku` (the default, for harness checks and every round so far) and `production`, which
 *  puts a scenario's Claude roles on Sonnet where the scenario defines it. Per-role USD caps are scaled
 *  by PRICE_SCALE on the production profile, so a cap keeps the same token room; the org-wide stop is
 *  not scaled. The factor is MEASURED, not assumed: a probe on 2026-10-02 priced the same tiny call at
 *  $0.0190 on Haiku 4.5 and $0.0398 on Sonnet 5.5, which matches list prices of $1/$5 per million
 *  input/output tokens (cache read $0.10, 1-hour cache write $2) for Haiku and exactly twice that for
 *  Sonnet 5.5 ($2/$10, $0.20, $4). */
export const PROFILES = ['haiku', 'production'];
export const PRICE_SCALE = { haiku: 1, production: 2 };

export const RUNNER_PLANS = {
  'research-report': { workers: CODEX },
  'deliberative-design': { workers: CODEX },
  'sparse-dispatch': { workers: CLAUDE },
  'dev-feature-qa': { workers: CLAUDE },
  // Haiku by default (rounds so far); the production profile puts all three roles on Sonnet (2026-10-03).
  'dev-feature-qa-revise': {
    workers: CLAUDE,
    production: { native: true, claudeModel: SONNET },
  },
  // The growth org keeps each role's own runner (two designers run on codex and antigravity);
  // only its Claude roles are pinned to Haiku. Identical in both contenders.
  'growth-like': { native: true, production: { native: true, claudeModel: SONNET } },
  // Every role is a Claude role (the kit builds its own definition, no snapshot); native like growth-like so
  // the production profile pins them all to Sonnet and scales the caps by the price ratio.
  'parallel-sweep': { native: true, production: { native: true, claudeModel: SONNET } },
  _selftest: { workers: CLAUDE },
};

/** A scenario's runner plan under a profile; scenarios without a production variant are unchanged. */
export function resolvePlan(scenario, profile = 'haiku') {
  if (!PROFILES.includes(profile)) throw new Error(`profile must be one of ${PROFILES.join(', ')}`);
  const plan = RUNNER_PLANS[scenario];
  if (!plan) throw new Error(`no runner plan for scenario "${scenario}"`);
  return profile === 'production' && plan.production ? plan.production : plan;
}

/** Token caps counted on the billable basis (cache reads included), because the runners that report
 *  no USD report tokens, and most of a long session's tokens are cache reads. The codex dry run used
 *  11.9M tokens of which 9.5M was the Claude lead's cache reads: caps counting only uncached tokens
 *  (0.5M there) bound nothing. Sized from that run: the busiest codex role used 1.6M, so 4M per
 *  unpriced role stops a runaway at about 2.5x; the org ceiling covers a Claude root's cache reads too. */
export const UNPRICED_ROLE_TOKENS = 4_000_000;
export const ORG_TOKENS = 60_000_000;

const isRoot = (r) => r.reports_to == null;
/** A role's runner: an explicit `runtime`, else its `provider.kind`, else Claude. */
export const runtimeOf = (role) => role.runtime ?? role.provider?.kind ?? 'claude';
export const planFor = (role, plan) => (isRoot(role) ? CLAUDE : plan.workers);
export const isUnpriced = (runner) => runner.runtime !== 'claude';

/** Pin every role to its scenario's runner and model; the root role is Claude Haiku. */
export function applyModel(def, plan = { workers: CLAUDE }) {
  const out = structuredClone(def);
  for (const r of out.roles) {
    if (plan.native && r.provider) continue; // keeps its own runner and model
    const p = plan.native
      ? { runtime: 'claude', model: plan.claudeModel ?? MODEL }
      : planFor(r, plan);
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
    def.roles.map((r) => [r.id, { runtime: runtimeOf(r), model: r.adapter_config?.model }]),
  );
}

/** Soft stops: USD per priced role, summing to no more than the scenario's planning allocation
 *  (or, when an org-wide stop of at most the allocation bounds the run, summing to anything: the stop is
 *  the worst case); a token cap per role on an unpriced runner (which reports no USD); and one org-wide
 *  token cap, the same in every trial so no default decides a result. */
export function applyCaps(def, caps, allocationUsd, { orgStopUsd } = {}) {
  const out = structuredClone(def);
  let usd = 0;
  for (const r of out.roles) {
    if (!(r.id in caps)) throw new Error(`role ${r.id} has no cap`);
    if (isUnpriced({ runtime: runtimeOf(r) })) r.budget_tokens = UNPRICED_ROLE_TOKENS;
    else {
      r.budget_usd = caps[r.id];
      usd += caps[r.id];
    }
  }
  for (const id of Object.keys(caps))
    if (!out.roles.some((r) => r.id === id)) throw new Error(`cap for unknown role ${id}`);
  if (orgStopUsd !== undefined && orgStopUsd > allocationUsd + 1e-9)
    throw new Error(
      `the org-wide stop ($${orgStopUsd}) is over the $${allocationUsd} planning allocation`,
    );
  if (orgStopUsd === undefined && usd > allocationUsd + 1e-9)
    throw new Error(`role caps sum to $${usd}, over the $${allocationUsd} planning allocation`);
  out.run_config = {
    ...(out.run_config ?? {}),
    budget_tokens: ORG_TOKENS,
    budget_tokens_basis: 'billable',
  };
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
