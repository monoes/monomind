// packages/@monomind/cli/src/orgrt/org-sign-review.ts
/**
 * #502 review: what `org sign` shows before the operator signs a
 * definition — everything in it that decides what a role may run, reach or
 * be granted, the roles that run with no OS confinement (they can read the
 * operator key and sign anything), and a diff against the projection that
 * was signed last.
 */

import { authorityMaskAvailability } from './authority-mask.js';
import { sandboxAvailability } from './role-sandbox-restrictions.js';
import { effectiveRoleRuntime } from './runner-specs.js';
import { listSkills } from './skill-library.js';

/** #502 review round 2: org skills that don't ship with monomind — from the
 *  project's or the user's library. They decide MCP tools the daemon grants
 *  and are not signed by content, so `org sign` and `doctor` list them. */
export function nonBundledSkillLines(projectRoot: string): string[] {
  return listSkills(projectRoot)
    .filter((s) => s.origin === 'project' || s.origin === 'user')
    .map(
      (s) =>
        `  ${s.name} (${s.origin}, ${s.dir})${s.tools.length ? ` · tools ${s.tools.join(', ')}` : ''}`,
    );
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const json = (v: unknown, max = 240): string => {
  const s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

function toolProviderLines(tps: unknown): string[] {
  if (!Array.isArray(tps)) return [];
  return tps.map((tp) => {
    const t = obj(tp);
    const cmd = [t.command, ...(Array.isArray(t.args) ? t.args : [])].map(String).join(' ');
    const env = Object.keys(obj(t.env));
    return `      tool provider ${String(t.name)}: runs \`${cmd}\`${env.length ? ` · env ${env.join(', ')}` : ''}${t.allow ? ` · allow ${json(t.allow)}` : ''}`;
  });
}

/** Roles that would run with neither the SDK sandbox nor the bubblewrap
 *  mask on this machine, with why. Such a role's Bash can read the operator
 *  key and so sign any org definition. Mirrors session-run.ts's choice:
 *  full access skips both; the SDK sandbox is for the claude runtime below
 *  `push` with `policy.sandbox.mode` not 'off'; the mask covers the rest on
 *  Linux with a working bubblewrap; the in-process vercel runtime has no
 *  shell at all. */
export function unconfinedRoles(
  raw: unknown,
  env: {
    sdkSandbox?: { available: boolean; reason?: string };
    mask?: { available: boolean; reason?: string };
  } = {},
): Array<{ id: string; why: string }> {
  const def = obj(raw);
  const sdk = env.sdkSandbox ?? sandboxAvailability();
  const mask = env.mask ?? authorityMaskAvailability();
  const out: Array<{ id: string; why: string }> = [];
  for (const r of Array.isArray(def.roles) ? def.roles : []) {
    const role = obj(r);
    const policy = obj(role.policy);
    // #567: the runner that hosts it, provider.kind included.
    const runtime = effectiveRoleRuntime(role.runtime, def.runtime, obj(role.provider).kind);
    const id = String(role.id);
    if (policy.access === 'full') {
      out.push({ id, why: 'policy.access full (no sandbox, no mask)' });
      continue;
    }
    if (runtime === 'vercel') continue;
    const git = String(policy.git ?? 'read');
    const mode = String(obj(policy.sandbox).mode ?? 'auto');
    if (runtime === 'claude' && git !== 'push' && mode !== 'off' && sdk.available) continue;
    if (mask.available) continue;
    const noSdk =
      runtime !== 'claude'
        ? `runtime ${runtime}`
        : git === 'push'
          ? 'policy.git push'
          : mode === 'off'
            ? "policy.sandbox.mode 'off'"
            : `no SDK sandbox (${sdk.reason ?? 'unavailable'})`;
    out.push({ id, why: `${noSdk}, and no bubblewrap mask (${mask.reason ?? 'unavailable'})` });
  }
  return out;
}

/** Env spelling of the `--allow-unconfined` opt-in, for harnesses and service units. */
export const ALLOW_UNCONFINED_ENV = 'MONOMIND_ALLOW_UNCONFINED';

export function confinementRefusal(org: string, loose: Array<{ id: string; why: string }>): string {
  const roles = loose.map((r) => `  - ${r.id}: ${r.why}`).join('\n');
  return (
    `org ${org} has roles that would run without an OS sandbox, so they can read the operator key and sign any org definition:\n${roles}\n` +
    `Fix: install bubblewrap (Linux), use the claude runtime below policy.git push with the sandbox on, ` +
    `or explicitly accept the risk with --allow-unconfined (org run / org serve) or ${ALLOW_UNCONFINED_ENV}=1.`
  );
}

/** THE enforcement point for unconfined roles, called once per org start
 *  (prepareOrgStart). A role that runs with neither the SDK sandbox nor the
 *  mask can read the operator key and so sign any org definition. Fails
 *  closed (supersedes the warn-only decision of #502): the start is refused
 *  unless the operator passed the explicit `allowUnconfined` opt-in
 *  (`--allow-unconfined` / MONOMIND_ALLOW_UNCONFINED=1), in which case each
 *  role is still named in a warning so the opt-in is on the record. */
export function enforceConfinement(
  def: unknown,
  org: string,
  opts: { allowUnconfined?: boolean; warn?: (msg: string) => void } = {},
): Array<{ id: string; why: string }> {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const loose = unconfinedRoles(def);
  if (loose.length === 0) return loose;
  const allowed = opts.allowUnconfined === true || process.env[ALLOW_UNCONFINED_ENV] === '1';
  if (!allowed) throw new Error(confinementRefusal(org, loose));
  for (const r of loose)
    warn(
      `[orgrt] org ${org}: role ${r.id} runs unconfined by operator opt-in (--allow-unconfined) (${r.why}) — it runs without an OS sandbox and can read the operator key and sign any org definition`,
    );
  return loose;
}

/** The review `org sign` prints: one block per role, then the org-level
 *  settings, then the unconfined roles. */
export function describeOrgAuthority(raw: unknown): string[] {
  const def = obj(raw);
  const lines: string[] = [];
  for (const r of Array.isArray(def.roles) ? def.roles : []) {
    const role = obj(r);
    const policy = obj(role.policy);
    const head = [
      `runtime ${effectiveRoleRuntime(role.runtime, def.runtime, obj(role.provider).kind)}`,
      `git ${String(policy.git ?? 'read')}`,
      `access ${String(policy.access ?? 'scoped')}`,
    ];
    if (role.kind) head.push(`kind ${String(role.kind)}`);
    lines.push(`  ${String(role.id)}: ${head.join(' · ')}`);
    const detail: Array<[string, unknown]> = [
      ['adapter_config', role.adapter_config],
      ['provider', role.provider],
      ['endpoint', role.endpoint],
      ['instructions_file', role.instructions_file],
      ['blueprint', role.blueprint],
      ['skills', role.skills],
      ['skill_pool', role.skill_pool],
      ['budget_usd', role.budget_usd],
      ['budget_tokens', role.budget_tokens],
    ];
    for (const key of [
      'fileWrite',
      'fileRead',
      'allowTools',
      'denyTools',
      'webAllow',
      'autoApproveTools',
      'approvalTools',
      'settings',
      'sandbox',
    ])
      detail.push([`policy.${key}`, policy[key]]);
    for (const [k, v] of detail) if (v !== undefined) lines.push(`      ${k}: ${json(v)}`);
    lines.push(...toolProviderLines(role.tool_providers));
  }
  const rc = obj(def.run_config);
  const org: string[] = [];
  if (def.runtime !== undefined) org.push(`runtime: ${String(def.runtime)}`);
  if (def.schedule != null) org.push(`schedule: ${String(def.schedule)}`);
  if (rc.workspace !== undefined) org.push(`workspace: ${String(rc.workspace)}`);
  for (const pc of Array.isArray(rc.prechecks) ? rc.prechecks : []) {
    const p = obj(pc);
    org.push(`precheck ${String(p.name)}: runs \`${String(p.command)}\``);
  }
  if (rc.allow_unattended_full_access !== undefined)
    org.push(`allow_unattended_full_access: ${String(rc.allow_unattended_full_access)}`);
  if (rc.accept_full_access_taint !== undefined)
    org.push(`accept_full_access_taint: ${json(rc.accept_full_access_taint)}`);
  for (const k of ['federation', 'fence', 'loadouts'])
    if (def[k] !== undefined) org.push(`${k}: ${json(def[k])}`);
  if (org.length) lines.push('  org:', ...org.map((l) => `      ${l}`));
  const loose = unconfinedRoles(raw);
  if (loose.length) {
    lines.push(
      '  WARNING — these roles run unconfined here: they can read the operator key and sign anything:',
    );
    for (const r of loose) lines.push(`      ${r.id}: ${r.why}`);
  }
  return lines;
}

function flatten(v: unknown, path: string, out: Map<string, string>): void {
  // The role list compares role by role, keyed by id.
  if (path === 'roles' && Array.isArray(v) && v.every((r) => typeof obj(r).id === 'string')) {
    for (const r of v) flatten(r, `roles[${String(obj(r).id)}]`, out);
    return;
  }
  if (Array.isArray(v) || !v || typeof v !== 'object') {
    out.set(path || '(root)', JSON.stringify(v));
    return;
  }
  const keys = Object.keys(v as Obj);
  if (!keys.length) out.set(path || '(root)', '{}');
  for (const k of keys) flatten((v as Obj)[k], path ? `${path}.${k}` : k, out);
}

/** What changed between the last signed projection and this one, one line
 *  per changed leaf (arrays compare whole). */
export function projectionDiff(before: unknown, after: unknown): string[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, '', a);
  flatten(after, '', b);
  const lines: string[] = [];
  const cut = (s: string) => (s.length > 240 ? `${s.slice(0, 240)}…` : s);
  for (const [k, v] of b) {
    const old = a.get(k);
    if (old === undefined) lines.push(`  + ${k}: ${cut(v)}`);
    else if (old !== v) lines.push(`  ~ ${k}: ${cut(old)} → ${cut(v)}`);
  }
  for (const [k, v] of a) if (!b.has(k)) lines.push(`  - ${k}: ${cut(v)}`);
  return lines;
}
