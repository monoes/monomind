// packages/@monomind/cli/src/orgrt/approval-decider.ts
/**
 * #553: approvals mono-agent resolves wait inline for the verdict.
 *
 * An org's `autonomy` block is mono-agent's display copy of its enforced
 * settings (mono-agent internal/orgdecide/reconcile.go:17-78). mono-agent's
 * decision service polls monomind every 15s (service.go:106), routes each
 * pending approval by level × tier to a rule, a decider or a person
 * (route.go:118-138), and resolves the first two over /api/set-approval.
 * checkApproval only ever answered "pending", so the role's call was denied
 * as "pending human approval" and the role had to retry once mono-agent had
 * approved it.
 *
 * awaitApproval queues the request as before and, when the org's autonomy
 * routes it to a rule or a decider, holds the call until it is resolved or
 * the bounded wait runs out. A request routed to a person — and any org whose
 * autonomy block is missing, paused or not understood — returns at once.
 *
 * Known gap: `monoagentcli org autonomy pause` writes only mono-agent's DB
 * (cmd/monoagentcli/org_autonomy.go:319-384, PausedUntil), not the display
 * copy, so monomind cannot see a pause today and waits (up to the bound)
 * while mono-agent routes to a person. `paused_until` (ISO date) and
 * `paused: true` in the display copy are honoured for when it does.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type ApprovalWaitResult, abandonApprovalWaiters } from './approval-waiters.js';
import { checkApprovalEntry, setApproval } from './approvals.js';
import type { OrgDaemon } from './daemon.js';
import { consultDecisionRole, type RoleLike, roleDeciderTarget } from './decision-decider.js';
import { DECISION_TIMEOUT_MS, type DecisionDeps, findDecisionRole } from './decision-roles.js';
import { ORG_DIR } from './types.js';

/** mono-agent's decider timeout when none is set (orgdecide/store.go:29). */
export const DECIDER_TIMEOUT_DEFAULT_S = 120;
/** Slack on top of the decider timeout: up to one 15s poll tick before
 *  mono-agent sees the request, plus the 10s it adds to the decider call
 *  (service.go:106, 390). */
export const DECIDER_WAIT_SLACK_S = 25;
/** Upper bound on the inline wait. Claude's PreToolUse hook lets a call
 *  PROCEED when the hook times out (POLICY_HOOK_TIMEOUT_S, 600s), so the
 *  wait stays well below that. */
export const DECIDER_WAIT_MAX_S = 300;

type Tier = 'routine' | 'consequential' | 'irreversible';
const TIERS = new Set<string>(['routine', 'consequential', 'irreversible']);
const LEVELS = new Set<string>(['manual', 'mid', 'full']);
/** Slack on top of the decision role's provider timeout for the lock and the resolve. */
const ROLE_DECIDER_SLACK_MS = 5_000;
const DECIDER_KINDS = new Set<string>(['model', 'boss', 'parent', 'jev', 'role']);

/** Port of mono-agent ClassForAction (internal/orgdecide/route.go:42-54). */
export function classForAction(action: string): string {
  if (action === 'org_complete') return 'org_complete';
  if (action.startsWith('monoagent__automation_'))
    return `grant:${action.slice('monoagent__automation_'.length)}`;
  if (action === 'monoagent__org_start') return 'org_start';
  return `tool:${action}`;
}

/** mono-agent DefaultTiers (route.go:56-64). */
const DEFAULT_TIERS: Record<string, Tier> = {
  'tool:*': 'routine',
  org_complete: 'consequential',
  question: 'consequential',
  org_start: 'consequential',
  gate: 'irreversible',
};

/** Port of mono-agent TierFor (route.go:74-107): exact override, then the
 *  tool:* / grant:* wildcard, then the default; unclassified is irreversible.
 *  Two facts mono-agent reads from its DB are not visible here:
 *  - A grant's own tier. mono-agent stores it only in its DB (the GrantSpec
 *    display copy in the org file has no tier) and gives a grant with no
 *    outbound workflow nodes `consequential` (orggrant/outbound.go:60-65).
 *    Here a grant with no grant:<alias> / grant:* override is irreversible,
 *    so at mid such a call is treated as human-owned and denied as pending
 *    at once, as before #553, while mono-agent actually routes it to the
 *    decider — a missed wait, not a safety issue. At full both route to the
 *    decider, so the ownership matches.
 *  - RoleHasGrantsAndBash, which only moves tool:Bash from routine to
 *    consequential — both routed away from a person at mid and full, so the
 *    ownership below is the same either way. */
export function tierFor(cls: string, overrides: Record<string, unknown>): Tier {
  const exact = overrides[cls];
  if (typeof exact === 'string' && TIERS.has(exact)) return exact as Tier;
  for (const p of ['tool:', 'grant:']) {
    if (cls.startsWith(p)) {
      const wild = overrides[`${p}*`];
      if (typeof wild === 'string' && TIERS.has(wild)) return wild as Tier;
    }
  }
  if (cls.startsWith('tool:')) return 'routine';
  if (cls.startsWith('grant:') || cls.startsWith('hil:')) return 'irreversible';
  return DEFAULT_TIERS[cls] ?? 'irreversible';
}

/** Port of mono-agent Route (route.go:118-138). */
export function routeFor(level: string, tier: Tier): 'rule' | 'decider' | 'human' {
  if (level === 'mid') {
    if (tier === 'routine') return 'rule';
    if (tier === 'consequential') return 'decider';
    return 'human';
  }
  if (level === 'full') return tier === 'routine' ? 'rule' : 'decider';
  return 'human';
}

export type ApprovalOwnership =
  | { owner: 'human' }
  | { owner: 'decider'; decider: string; waitMs: number; role?: string };

/** What the approval gate returns: the verdict plus who owns the request.
 *  `approved: null` means still pending (a human request, or an automated
 *  one not resolved within `waitedMs`). */
export interface ApprovalVerdict {
  approved: boolean | null;
  owner: 'human' | 'decider';
  /** Who resolves it, e.g. `decider model claude-opus` or `rule (routine at full)`. */
  decider?: string;
  /** Who resolved it (resolvedBy), when resolved. */
  resolvedBy?: string;
  /** How long the call waited, when it waited. */
  waitedMs?: number;
  /** The org stopped or the role closed while the call waited. */
  cancelled?: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Who resolves an approval of `action` under this autonomy block. Anything
 *  missing, paused, unknown or malformed is human-owned (no wait). */
export function approvalOwnership(
  autonomy: unknown,
  action: string,
  now: number = Date.now(),
  /** The org's roles, needed to trust a `role` decider (#835 PR 7); absent = human-owned. */
  roles?: readonly RoleLike[],
): ApprovalOwnership {
  return ownershipForClass(autonomy, classForAction(action), now, roles);
}

/** approvalOwnership for an already classified request (`gate` is a class of its own). */
export function ownershipForClass(
  autonomy: unknown,
  cls: string,
  now: number,
  roles?: readonly RoleLike[],
): ApprovalOwnership {
  const human = { owner: 'human' as const };
  if (!isObject(autonomy)) return human;
  const { level, decider, tiers } = autonomy;
  if (typeof level !== 'string' || !LEVELS.has(level)) return human;
  if (autonomy.paused === true) return human;
  if (autonomy.paused_until !== undefined && autonomy.paused_until !== null) {
    const until =
      typeof autonomy.paused_until === 'string' ? Date.parse(autonomy.paused_until) : Number.NaN;
    if (Number.isNaN(until) || until > now) return human;
  }
  if (!isObject(decider) || typeof decider.kind !== 'string' || !DECIDER_KINDS.has(decider.kind))
    return human;
  if (tiers !== undefined && !isObject(tiers)) return human;
  const t = decider.timeout_seconds;
  if (t !== undefined && (typeof t !== 'number' || !Number.isFinite(t) || t < 0)) return human;

  const roleTarget = decider.kind === 'role' ? roleDeciderTarget(decider, roles) : undefined;
  if (decider.kind === 'role' && !roleTarget) return human;

  const tier = tierFor(cls, tiers ?? {});
  const route = routeFor(level, tier);
  if (route === 'human') return human;
  if (roleTarget && route === 'decider')
    return {
      owner: 'decider',
      decider: `decision role ${roleTarget.id}`,
      waitMs: DECISION_TIMEOUT_MS + ROLE_DECIDER_SLACK_MS,
      role: roleTarget.id,
    };
  const timeoutS = typeof t === 'number' && t > 0 ? t : DECIDER_TIMEOUT_DEFAULT_S;
  const waitS = Math.min(timeoutS + DECIDER_WAIT_SLACK_S, DECIDER_WAIT_MAX_S);
  const label =
    route === 'rule'
      ? `rule (${tier} at ${level})`
      : `decider ${decider.kind}${typeof decider.model === 'string' && decider.model ? ` ${decider.model}` : ''}`;
  return { owner: 'decider', decider: label, waitMs: Math.round(waitS * 1000) };
}

const autonomyCache = new Map<string, { mtimeMs: number; size: number; autonomy: unknown }>();

/** The org file's autonomy block, read fresh (cached by mtime and size) so a
 *  level change made while the org runs is seen on the next check. Undefined
 *  when the file is missing or unparseable. */
export function readOrgAutonomy(root: string, org: string): unknown {
  const path = join(root, ORG_DIR, `${org}.json`);
  try {
    const st = statSync(path);
    const hit = autonomyCache.get(path);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.autonomy;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const autonomy = isObject(parsed) ? parsed.autonomy : undefined;
    autonomyCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, autonomy });
    return autonomy;
  } catch {
    autonomyCache.delete(path);
    return undefined;
  }
}

/** checkApproval, plus the #553 inline wait for a request mono-agent owns. */
export async function awaitApproval(
  daemon: OrgDaemon,
  org: string,
  role: string,
  action: string,
  input: Record<string, unknown> = {},
  /** Test seam for the decision role's provider. */
  deps: Pick<DecisionDeps, 'ask' | 'resolveProvider'> = {},
): Promise<ApprovalVerdict> {
  let ownership: ApprovalOwnership = { owner: 'human' };
  const stillLive = () => {
    const running = daemon.orgs.get(org);
    return !!running && !running.agents.get(role)?.mailbox.isClosed;
  };
  const started = Date.now();
  const { approved, entry, wait } = await checkApprovalEntry(
    daemon,
    org,
    role,
    action,
    input,
    (normalized) => {
      ownership = approvalOwnership(
        readOrgAutonomy(daemon.root, org),
        normalized,
        Date.now(),
        daemon.orgs.get(org)?.def.roles,
      );
      return ownership.owner === 'decider' ? { timeoutMs: ownership.waitMs, stillLive } : undefined;
    },
  );
  const owned = ownership as ApprovalOwnership;
  if (!wait || owned.owner === 'human')
    return { approved, owner: 'human', resolvedBy: entry?.resolvedBy };
  if (owned.role && entry) {
    const target = findDecisionRole(daemon.orgs.get(org)?.def, owned.role);
    const verdict = target
      ? await consultDecisionRole(
          target,
          `Approval request from role "${role}": may it run tool ${entry.action}? Input: ${JSON.stringify(entry.input ?? {})}`,
          deps,
        )
      : { approved: null, why: 'decision role vanished' };
    if (verdict.approved === null) {
      // Never approve on failure: the request stays queued for a person, as a human-owned one.
      abandonApprovalWaiters(entry);
      daemon.orgs.get(org)?.bus.emit({
        type: 'audit',
        from: owned.role,
        reason: 'decision-forwarded',
        msg: `decision role "${owned.role}" left ${entry.action} for ${role} to a human: ${'why' in verdict ? verdict.why : ''}`,
        data: { role: owned.role, requestId: entry.requestId },
      });
      await wait;
      return { approved: null, owner: 'human', resolvedBy: entry.resolvedBy };
    }
    await setApproval(daemon, org, role, entry.action, verdict.approved, {
      resolvedBy: `decision:${owned.role}`,
      requestId: entry.requestId,
    });
  }
  const result: ApprovalWaitResult = await wait;
  return {
    approved: result.approved,
    owner: 'decider',
    decider: owned.decider,
    resolvedBy: entry?.resolvedBy,
    waitedMs: Date.now() - started,
    ...(result.cancelled ? { cancelled: true } : {}),
  };
}
