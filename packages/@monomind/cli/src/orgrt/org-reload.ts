// packages/@monomind/cli/src/orgrt/org-reload.ts
// Extracted from daemon.ts — hot-reloading a running org's definition.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOrgDefBlueprints } from '../catalog/blueprints.js';
import { reopenBudgetClosedRoles, rolesOnDefTokenCaps } from './budget-closure.js';
import type { OrgDaemon } from './daemon.js';
import { sectionRoleCap, syncSectionBudgets } from './documents/section-budget-wire.js';
import { isEndpointRole } from './endpoint-roles.js';
import {
  assertOrgDefSigned,
  instructionsDigests,
  OrgSignatureError,
  pinInstructionDigests,
} from './org-signature.js';
import { expandOrgPolicyPathVars, promptVarsFor } from './prompt-vars.js';
import { computeReplacementBudget } from './role-slot.js';
import { ORG_DIR, OrgDefSchema } from './types.js';
import { checklistFindings } from './validate-checklist.js';

export function reloadOrgDef(
  daemon: OrgDaemon,
  name: string,
): { changed: string[]; newRoles: string[]; removedRoles: string[] } {
  const running = daemon.orgs.get(name);
  if (!running) throw new Error(`org ${name} is not running`);
  const defPath = join(daemon.root, ORG_DIR, `${name}.json`);
  const rawDef: unknown = JSON.parse(readFileSync(defPath, 'utf8'));
  // #502: an unsigned or tampered definition changes nothing — the running
  // org keeps the last definition that verified (the one it started or last
  // reloaded with).
  const digests = instructionsDigests(rawDef, daemon.root);
  try {
    assertOrgDefSigned(daemon.root, name, rawDef, { digests });
  } catch (err) {
    if (!(err instanceof OrgSignatureError)) throw err;
    running.bus.emit({
      type: 'audit',
      reason: 'hot-reload-refused',
      msg: `org def reload refused: ${err.message}`,
      data: { reason: err.reason },
    });
    throw new OrgSignatureError(
      `reload refused, the running org keeps its last verified definition: ${err.message}`,
      err.reason,
    );
  }
  const parsedDef = OrgDefSchema.parse(rawDef);
  const bp = resolveOrgDefBlueprints(parsedDef, daemon.root, digests);
  if (bp.errors.length) throw new Error(`org ${name}: ${bp.errors.join('; ')}`);
  const newDef = expandOrgPolicyPathVars(bp.def, promptVarsFor(daemon.root));
  // Org sections spec 6.14: run the checklist on the proposed definition
  // before applying anything; a failing one leaves the running org as is.
  const checklist = checklistFindings(newDef);
  if (checklist.errors.length) throw new Error(`org ${name}: ${checklist.errors.join('; ')}`);
  pinInstructionDigests(newDef, digests); // for roles this reload adds
  const changed: string[] = [];
  const newRoles: string[] = [];
  const removedRoles: string[] = [];
  const onDefTokenCaps = rolesOnDefTokenCaps(running);

  if (newDef.goal !== running.def.goal) {
    running.def.goal = newDef.goal;
    changed.push('goal');
  }

  const oldRc = running.def.run_config as Record<string, unknown>;
  const newRc = newDef.run_config as Record<string, unknown>;
  for (const key of new Set([...Object.keys(oldRc), ...Object.keys(newRc)])) {
    if (JSON.stringify(oldRc[key]) !== JSON.stringify(newRc[key])) {
      oldRc[key] = newRc[key];
      changed.push(`run_config.${key}`);
    }
  }

  changed.push(...syncSectionBudgets(running.def, newDef)); // P4.5: allocations first, for the caps below

  // M1 (C-37): apply changes to EXISTING roles' tool_providers, endpoint,
  // kind and policy. Fields are replaced on the live role object (sessions
  // read tool_providers at their next start, checkApproval reads policy
  // live) and a running role's PolicyEngine gets the new policy now.
  // #343: budget_usd / budget_tokens too — the live PolicyEngine gets the
  // new caps with its spend kept, and a role closed for budget reopens
  // below once it is no longer over them.
  const RELOADABLE_ROLE_FIELDS = [
    'tool_providers',
    'endpoint',
    'kind',
    'policy',
    'budget_usd',
    'budget_tokens',
  ] as const;
  for (const next of newDef.roles) {
    const live = running.def.roles.find((r) => r.id === next.id);
    if (!live) continue;
    const liveRec = live as Record<string, unknown>;
    const nextRec = next as Record<string, unknown>;
    for (const field of RELOADABLE_ROLE_FIELDS) {
      if (JSON.stringify(liveRec[field]) === JSON.stringify(nextRec[field])) continue;
      const targets = new Set<Record<string, unknown>>([liveRec]);
      const slotRole = running.roleSlots.get(next.id)?.effectiveRole as
        | Record<string, unknown>
        | undefined;
      if (slotRole) targets.add(slotRole);
      const pending = running.pendingRoles?.get(next.id) as Record<string, unknown> | undefined;
      if (pending) targets.add(pending);
      for (const t of targets) {
        if (nextRec[field] === undefined) delete t[field];
        else t[field] = nextRec[field];
      }
      if (field === 'policy') running.agents.get(next.id)?.policy.updatePolicy(next.policy ?? {});
      if (field === 'budget_usd' || field === 'budget_tokens')
        running.agents.get(next.id)?.policy.setBudgetCaps({
          maxTokens: live.policy?.maxTokens ?? computeReplacementBudget(running.def, next.id),
          maxUsd: sectionRoleCap(newDef, next.id) ?? live.policy?.maxUsd ?? live.budget_usd,
        });
      changed.push(`role:${next.id}:${field}`);
    }
  }
  const reopened = reopenBudgetClosedRoles(daemon, name, running, onDefTokenCaps);

  const existingRoleIds = new Set(running.def.roles.map((r) => r.id));
  const newRoleIds = new Set(newDef.roles.map((r) => r.id));
  for (const role of newDef.roles) {
    if (!existingRoleIds.has(role.id)) {
      running.def.roles.push(role);
      // M2: an endpoint role never gets a session — nothing to lazy-spawn.
      // #552: while the org-wide budget ceiling is spent, set it aside with
      // the other unspawned roles — a reload that raises it makes it pending.
      if (!isEndpointRole(role)) {
        if (running.orgBudgetClosed)
          (running.orgBudgetPendingRoles ??= new Map()).set(role.id, role);
        else (running.pendingRoles ??= new Map()).set(role.id, role);
      }
      newRoles.push(role.id);
    }
  }
  for (const id of existingRoleIds) {
    if (!newRoleIds.has(id)) removedRoles.push(id);
  }

  running.bus.emit({
    type: 'audit',
    reason: 'hot-reload',
    msg: `org def reloaded: ${changed.length} fields changed, ${newRoles.length} new roles, ${removedRoles.length} removed roles${reopened.length ? `, reopened ${reopened.join(', ')}` : ''}`,
    data: { changed, newRoles, removedRoles },
  });

  return { changed, newRoles, removedRoles };
}
