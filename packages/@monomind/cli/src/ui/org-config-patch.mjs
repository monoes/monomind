// The dashboard's writes to an org definition: the Config tab's patch
// (patchOrgConfig), the role editor's patch (patchOrgRole) and the validation
// every whole-definition write shares (assertValidOrgDef). Re-exported by
// org-runtime.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { accessValidationFindings } from '../orgrt/access-validate.js';
import { validateCostTiers } from '../orgrt/cost-tier.js';
import { patchCompletion } from '../orgrt/documents/completion-accessor.js';
import { parseSchedule } from '../orgrt/scheduler.js';
import { OrgDefSchema } from '../orgrt/types.js';
import { checklistFindings } from '../orgrt/validate-checklist.js';
import { writeFileAtomic } from './org-hil.mjs';

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
  'max_tool_rounds',
  'verify_writes',
  'lead_watch',
  'block_recheck_minutes',
  'notify_task_creator',
  'bash_timeout_ms',
  'session_idle_exit_ms',
]);
// Deliberately absent: allow_unattended_full_access and accept_full_access_taint
// are human-only (types.ts: covered by every full-access role's ack hash), and
// budget_usd, budget_mode and experimental are deferred by the checklist.

/** Role fields the role editor may set, by the key the patch uses. `model` is
 *  adapter_config.model and `cost_tier` is cost_tiers.roles.<id>. Everything
 *  else on a role (policy, tool_providers, endpoint, skills, provider, ...) is
 *  left exactly as it is on disk. */
const EDITABLE_ROLE_FIELDS = new Set([
  'runtime',
  'model',
  'max_turns_per_message',
  'max_tool_rounds',
  'budget_tokens',
  'budget_usd',
  'session_scope',
  'review_input',
  'deliberative',
  'cost_tier',
]);
/** An endpoint role is an HTTP automation, not a session (endpoint-roles.ts). */
const ENDPOINT_FORBIDDEN = ['runtime', 'model', 'budget_tokens', 'budget_usd'];

export class ConfigRejected extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

/** Throw ConfigRejected unless `def` passes the OrgDefSchema parse, cost-tier
 *  check and checklist `org run` applies. Used before any dashboard write of a
 *  whole definition (config patch, import, create). Returns the checklist's
 *  advice warnings, which never block a save. */
export function assertValidOrgDef(def) {
  const parsed = OrgDefSchema.safeParse(def);
  if (!parsed.success)
    throw new ConfigRejected(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  const tierProblems = validateCostTiers(parsed.data);
  if (tierProblems.length) throw new ConfigRejected(tierProblems);
  // Org sections spec 7.3: the shared checklist; advice never blocks a save.
  const { errors, warnings } = checklistFindings(parsed.data);
  // `org validate`'s access check: e.g. a policy.access 'full' role on a runtime that cannot honour it.
  const access = accessValidationFindings(parsed.data);
  if (errors.length || access.errors.length)
    throw new ConfigRejected([...errors, ...access.errors]);
  return [...warnings, ...access.warnings];
}

/** The section 7.3 checklist of a definition that may not parse: `errors`
 *  block a save (deferred features), `warnings` are advice. */
export function orgChecklist(def) {
  const parsed = OrgDefSchema.safeParse(def);
  return parsed.success ? checklistFindings(parsed.data) : { errors: [], warnings: [] };
}

/** A schedule the scheduler can run (scheduler.ts parseSchedule): "45s", "15m",
 *  "2h" or a number of minutes. Cron is not supported. */
function scheduleProblem(v) {
  if (v === null) return null;
  if (typeof v !== 'string' && typeof v !== 'number')
    return 'schedule must be a string or a number of minutes';
  const ms = parseSchedule(v);
  return ms !== null && ms > 0
    ? null
    : 'schedule must be an interval such as "45s", "15m" or "2h", or a number of minutes (cron is not supported)';
}

/** Apply `patch` ({ goal?, schedule?, runtime?, run_config?, cost_tiers_default? }) to
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
  if (patch.schedule !== undefined) {
    next.schedule = patch.schedule === '' ? null : patch.schedule;
    // Only a changed schedule is checked, so saving other fields never fails on a schedule already on disk.
    const bad = next.schedule !== (raw.schedule ?? null) && scheduleProblem(next.schedule);
    if (bad) problems.push(bad);
  }
  if (patch.runtime !== undefined) {
    if (patch.runtime === null || patch.runtime === '') delete next.runtime;
    else next.runtime = patch.runtime;
  }
  if (patch.run_config !== undefined) {
    const rc = { ...(raw.run_config ?? {}) };
    for (const [k, v] of Object.entries(patch.run_config ?? {})) {
      if (!EDITABLE_RUN_CONFIG.has(k)) {
        problems.push(`run_config.${k} is not editable here`);
        continue;
      }
      if (k === 'completion') {
        const c = patchCompletion(rc, v);
        if (!c.ok) {
          problems.push(c.problem);
          continue;
        }
        if (c.value === null) delete rc[k];
        else rc[k] = c.value;
      } else if (v === null) delete rc[k];
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
  assertValidOrgDef(next);
  writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Apply a role-editor `patch` (keys in EDITABLE_ROLE_FIELDS; `null` removes
 *  the field) to one role of the definition on disk, under the same checks as
 *  patchOrgConfig. Returns the definition as written. */
export function patchOrgRole(root, org, roleId, patch) {
  const file = path.join(root, '.monomind', 'orgs', `${org}.json`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ConfigRejected([`cannot read ${file}: ${err.message}`]);
  }
  const idx = (raw.roles ?? []).findIndex((r) => r?.id === roleId);
  if (idx < 0) throw new ConfigRejected([`role "${roleId}" not found in org "${org}"`]);
  const role = { ...raw.roles[idx] };
  const next = { ...raw, roles: raw.roles.map((r, i) => (i === idx ? role : r)) };
  const problems = [];
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!EDITABLE_ROLE_FIELDS.has(k)) {
      problems.push(`role field ${k} is not editable here`);
      continue;
    }
    if (role.kind === 'endpoint' && ENDPOINT_FORBIDDEN.includes(k)) {
      problems.push(
        `${k} is not allowed on endpoint role "${roleId}" (it is an automation, not a session)`,
      );
      continue;
    }
    const clear = v === null || v === '';
    if (k === 'model') {
      const ac = { ...(role.adapter_config ?? {}) };
      if (clear) delete ac.model;
      else ac.model = v;
      if (Object.keys(ac).length) role.adapter_config = ac;
      else delete role.adapter_config;
    } else if (k === 'cost_tier') {
      const ct = { ...(raw.cost_tiers ?? {}) };
      const roles = { ...(ct.roles ?? {}) };
      const was = roles[roleId];
      // An object entry also carries an effort override; keep it, change the tier.
      if (clear) delete roles[roleId];
      else roles[roleId] = was && typeof was === 'object' ? { ...was, tier: v } : v;
      if (Object.keys(roles).length) ct.roles = roles;
      else delete ct.roles;
      if (Object.keys(ct).length) next.cost_tiers = ct;
      else delete next.cost_tiers;
    } else if (clear) delete role[k];
    else role[k] = v;
  }
  if (problems.length) throw new ConfigRejected(problems);
  assertValidOrgDef(next);
  writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
