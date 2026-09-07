// packages/@monomind/cli/src/orgrt/role-slot.ts
/**
 * Pure, daemon-independent helpers and types for mid-run role replacement.
 * See docs/mastermind/specs/2026-09-07-org-runtime-role-respawn-design.md.
 */
import type { AgentRuntime } from './daemon.js';
import type { RuntimeKind } from './daemon.js';
import type { OrgRole } from './types.js';

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
