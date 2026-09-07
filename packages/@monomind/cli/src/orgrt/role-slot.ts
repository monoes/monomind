// packages/@monomind/cli/src/orgrt/role-slot.ts
/**
 * Pure, daemon-independent helpers and types for mid-run role replacement.
 * See docs/mastermind/specs/2026-09-07-org-runtime-role-respawn-design.md.
 */
import type { AgentRuntime } from './daemon.js';
import type { RuntimeKind } from './daemon.js';
import type { OrgDef, OrgRole } from './types.js';

export type RoleSlotPhase =
  | 'pending'
  | 'starting'
  | 'running'
  | 'draining'
  | 'ended'
  | 'crashed'
  | 'stuck'
  | 'removed';

export interface RetiredUsage {
  tokens: number;
  costUsd: number;
}

/** Only the fields org_respawn_role may override; everything else keeps the
 *  current effective value (see mergeEffectiveRoleConfig). */
export interface RoleOverrides {
  runtime?: RuntimeKind;
  model?: string;
  providerName?: string;
}

export interface RespawnReceipt {
  success: boolean;
  roleId: string;
  generation: number;
  respawnCount: number;
  respawnsRemaining: number;
  drainTimedOut?: boolean;
  error?: string;
}

export interface RoleSlot {
  generation: number;
  phase: RoleSlotPhase;
  runtime?: AgentRuntime;
  /** The role config actually in effect right now — the org definition's
   *  role, with any accepted overrides folded in. Never the original
   *  org-definition role once at least one replacement has happened. */
  effectiveRole: OrgRole;
  respawnCount: number;
  respawnPromise?: Promise<RespawnReceipt>;
  /** Messages that arrived while this slot was draining, not yet delivered
   *  to a live mailbox. */
  queuedDuringSwap: string[];
  retiredUsage: RetiredUsage;
  /** The live incarnation's cancellation handle — set whenever
   *  spawnRoleIncarnation is given one, so a later respawn can force-stop it. */
  abort?: AbortController;
}

/** Fold only the SUPPLIED override fields onto `current`; every omitted
 *  field keeps its current effective value (including across repeated
 *  replacements — `current` is always the slot's effectiveRole, never the
 *  original org-definition role, so this naturally persists overrides
 *  through however many replacements have already happened). */
export function mergeEffectiveRoleConfig(current: OrgRole, overrides: RoleOverrides): OrgRole {
  const merged: OrgRole = {
    ...current,
    ...(overrides.runtime !== undefined ? { runtime: overrides.runtime } : {}),
  };
  if (overrides.model !== undefined || overrides.providerName !== undefined) {
    merged.adapter_config = {
      ...current.adapter_config,
      ...(overrides.model !== undefined ? { model: overrides.model } : {}),
      ...(overrides.providerName !== undefined ? { provider: overrides.providerName } : {}),
    };
  }
  return merged;
}

/** The role's per-incarnation token ceiling when org_respawn_role omits
 *  `budgetTokens`: reuse the SAME allocator startup uses (daemon.ts's
 *  perRoleBudget computation), not the older even-split-only
 *  roleTokenBudget() helper. A role with its own budget_tokens override
 *  always gets that value; otherwise the remaining org budget (after
 *  subtracting every override) is split evenly across every role WITHOUT
 *  an override. */
export function computeReplacementBudget(def: OrgDef, roleId: string): number {
  const role = def.roles.find((r) => r.id === roleId);
  if (!role) throw new Error(`computeReplacementBudget: unknown role "${roleId}"`);
  if (role.budget_tokens != null) return role.budget_tokens;
  const orgBudgetTokens = def.run_config.budget_tokens ?? 1_000_000;
  const overriddenTokenSum = def.roles.reduce((sum, r) => sum + (r.budget_tokens ?? 0), 0);
  const unoverriddenRoleCount = def.roles.filter((r) => r.budget_tokens == null).length;
  return unoverriddenRoleCount > 0
    ? Math.max(0, Math.floor((orgBudgetTokens - overriddenTokenSum) / unoverriddenRoleCount))
    : 0;
}

const RUNTIME_KINDS = new Set<string>([
  'claude',
  'kimicode',
  'opencode',
  'vercel',
  'codex',
  'antigravity',
  'grok',
  'qwen',
  'crush',
  'copilot',
  'pi',
  'pi-rpc',
  'qwen-rpc',
]);

export interface RespawnInput {
  roleId: string;
  runtime?: RuntimeKind;
  model?: string;
  providerName?: string;
  budgetTokens?: number;
  reason: string;
  briefing: string;
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** Validate and bound every field of an org_respawn_role call before any
 *  state change or preflight is attempted. See the design doc's "Validation
 *  rules" — limits chosen there: roleId 128, reason 1000, briefing 20000. */
export function validateRespawnInput(
  input: unknown,
): { ok: true; value: RespawnInput } | { ok: false; error: string } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const roleId = boundedString(raw.roleId, 128);
  if (!roleId) return { ok: false, error: 'roleId is required (1-128 characters)' };
  const reason = boundedString(raw.reason, 1000);
  if (!reason) return { ok: false, error: 'reason is required (1-1000 characters)' };
  const briefing = boundedString(raw.briefing, 20_000);
  if (!briefing) return { ok: false, error: 'briefing is required (1-20000 characters)' };

  let runtime: RuntimeKind | undefined;
  if (raw.runtime !== undefined) {
    if (typeof raw.runtime !== 'string' || !RUNTIME_KINDS.has(raw.runtime)) {
      return { ok: false, error: `runtime must be one of: ${[...RUNTIME_KINDS].join(', ')}` };
    }
    runtime = raw.runtime as RuntimeKind;
  }

  let model: string | undefined;
  if (raw.model !== undefined) {
    const m = boundedString(raw.model, 256);
    if (!m) return { ok: false, error: 'model must be a non-empty string (max 256 characters)' };
    model = m;
  }

  let providerName: string | undefined;
  if (raw.providerName !== undefined) {
    const p = boundedString(raw.providerName, 128);
    if (!p)
      return { ok: false, error: 'providerName must be a non-empty string (max 128 characters)' };
    providerName = p;
  }

  let budgetTokens: number | undefined;
  if (raw.budgetTokens !== undefined) {
    const b = raw.budgetTokens;
    if (typeof b !== 'number' || !Number.isSafeInteger(b) || b <= 0) {
      return { ok: false, error: 'budgetTokens must be a positive integer' };
    }
    budgetTokens = b;
  }

  return {
    ok: true,
    value: { roleId, reason, briefing, runtime, model, providerName, budgetTokens },
  };
}

/** Audit/status-safe view of a role's runtime config — never includes
 *  role.provider (which may carry apiKey/authToken/baseUrl). */
export function redactRoleConfig(
  role: OrgRole,
): { runtime?: string; model?: string; providerName?: string } {
  const out: { runtime?: string; model?: string; providerName?: string } = {};
  if (role.runtime) out.runtime = role.runtime;
  if (role.adapter_config?.model) out.model = role.adapter_config.model;
  if (role.adapter_config?.provider) out.providerName = role.adapter_config.provider;
  return out;
}

export function buildRespawnReceipt(
  slot: Pick<RoleSlot, 'generation' | 'respawnCount'>,
  maxRespawns: number,
  success: boolean,
  extra: Partial<RespawnReceipt> = {},
): RespawnReceipt {
  return {
    success,
    roleId: '',
    generation: slot.generation,
    respawnCount: slot.respawnCount,
    respawnsRemaining: Math.max(0, maxRespawns - slot.respawnCount),
    ...extra,
  };
}
