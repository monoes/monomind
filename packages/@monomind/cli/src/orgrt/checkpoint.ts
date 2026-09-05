// packages/@monomind/cli/src/orgrt/checkpoint.ts
// Semantic checkpoint state management for org runtime - Pattern 3 implementation

import { createHash } from 'node:crypto';
import type { AgentRuntime, RunningOrg } from './daemon.js';
import { isRecoverableCloseReason } from './mailbox.js';
import type { OrgTask } from './task-dag.js';

/** Checkpoint state for a single agent role */
export interface RoleCheckpoint {
  /** Message queue content (actual messages, not just count) */
  mailboxQueue: string[];
  /** Whether the mailbox was closed */
  mailboxClosed: boolean;
  /** Why it was closed, if given a reason (e.g. 'token-budget') — see
   *  isRecoverableCloseReason in mailbox.ts; resume checks this before
   *  re-closing the restored mailbox. */
  mailboxCloseReason?: string;
  /** Token usage counter from policy engine */
  tokensUsed: number;
  /** Cost tracking */
  costUsd: number;
  /** Last message ID for threading */
  lastMessageId?: string;
  /** Session ID for SDK resume */
  sessionId?: string;
  /** Agent status */
  status: 'running' | 'ended' | 'crashed';
  /** Error message if crashed */
  error?: string;
  /** Terminal scrollback — last N lines of agent output. */
  scrollback?: string[];
}

/** Full checkpoint state for an org */
export interface OrgCheckpoint {
  /** R6: schema version — bumped on any breaking shape change so a future
   *  consumer can detect an old-shape checkpoint instead of failing the
   *  checksum and silently returning null. */
  version: number;
  status: 'running' | 'stopped' | 'crashed';
  run: string;
  pid: number;
  updated: string;
  /** Per-role checkpoint state */
  roleState: Record<string, RoleCheckpoint>;
  /** Roles not yet spawned (lazy spawn) */
  pendingRoles: string[];
  /** TaskDag snapshot (TaskDag.toJSON()), so resume can rehydrate it via
   *  TaskDag.fromJSON() instead of discarding all task state. */
  tasks?: OrgTask[];
  /** Checksum for state validation */
  checksum: string;
}

/** Current checkpoint format version. Bump on breaking shape changes. */
export const CHECKPOINT_VERSION = 1;

/** Checkpoint TTL config */
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours default

/**
 * Extract full checkpoint state from a RunningOrg
 * Called by persistState() to capture complete state for resume
 */
export function captureCheckpoint(
  org: RunningOrg,
  status: 'running' | 'stopped' | 'crashed' = 'running',
): OrgCheckpoint {
  const roleState: Record<string, RoleCheckpoint> = {};
  const pendingRoles: string[] = [];

  // Capture state for each running agent
  for (const [roleId, runtime] of org.agents) {
    roleState[roleId] = {
      mailboxQueue: runtime.mailbox.serialize().queue,
      mailboxClosed: runtime.mailbox.isClosed,
      mailboxCloseReason: runtime.mailbox.closeReason,
      tokensUsed: runtime.policy.usage,
      costUsd: runtime.metrics.costUsd,
      lastMessageId: runtime.lastMessageId,
      sessionId: runtime.sessionId, // P2-13: populated by session layer via onSessionId callback
      status: runtime.status,
      error: runtime.error,
      scrollback: runtime.scrollback?.snapshot(),
    };
  }

  // Capture pending roles (lazy spawn list)
  for (const roleId of org.pendingRoles?.keys() ?? []) {
    pendingRoles.push(roleId);
  }

  // Build checkpoint without checksum first
  const partial: Omit<OrgCheckpoint, 'checksum'> = {
    version: CHECKPOINT_VERSION,
    status,
    run: org.run,
    pid: process.pid,
    updated: new Date().toISOString(),
    roleState,
    pendingRoles,
    tasks: org.taskDag?.toJSON(),
  };

  // Generate checksum over all state
  const checksum = generateChecksum(partial);

  return { ...partial, checksum };
}

/**
 * Validate checkpoint integrity using checksum
 * Returns true if checksum matches AND the schema version is current.
 *
 * R6: a version field was added so future shape changes can be detected
 * explicitly. Old checkpoints (no version field) fail with a clear cause
 * instead of the silent checksum-mismatch → null return that masked the
 * real reason resume was impossible.
 */
export function validateCheckpoint(checkpoint: OrgCheckpoint): boolean {
  if (checkpoint.version !== CHECKPOINT_VERSION) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) {
      console.error(
        `[checkpoint] version mismatch: file has ${checkpoint.version ?? 'none'}, current is ${CHECKPOINT_VERSION}`,
      );
    }
    return false;
  }
  const { checksum, ...state } = checkpoint;
  const recomputed = generateChecksum(state);
  return checksum === recomputed;
}

/**
 * Check if checkpoint has expired based on TTL
 * Returns true if checkpoint is stale and should not be used
 */
export function isCheckpointExpired(
  checkpoint: OrgCheckpoint,
  ttlMs: number = CHECKPOINT_TTL_MS,
): boolean {
  const updated = new Date(checkpoint.updated).getTime();
  const now = Date.now();
  return now - updated > ttlMs;
}

/**
 * Generate checksum over checkpoint state.
 *
 * Uses a stable recursive stringify so semantically-equal checkpoints
 * (same keys + values, regardless of insertion order) hash identically.
 * Hashed with SHA-256 (truncated to 16 hex chars = 64 bits — plenty for
 * tamper detection across realistic checkpoint counts).
 *
 * T3 (and a real latent bug): the previous implementation called
 * `JSON.stringify(state, Object.keys(state).sort())`. Passing an array
 * as the second argument makes it a *whitelist* — but JSON.stringify
 * applies that whitelist at every level, not just the top. Since nested
 * keys like `tokensUsed` / `mailboxQueue` aren't in the top-level keys
 * list, they were silently stripped from the canonical form. Result: the
 * checksum was identical for any two checkpoints sharing the same
 * top-level shape, regardless of roleState values — validateCheckpoint
 * provided ZERO integrity guarantee.
 */
export function generateChecksum(state: Omit<OrgCheckpoint, 'checksum'>): string {
  const canonical = JSON.stringify(stableNormalize(state));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** Recursively produce a canonical form: object keys sorted at every depth,
 *  arrays preserved in order, primitives passed through. */
function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) out[k] = stableNormalize((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/**
 * Restore mailbox queue from checkpoint
 * Replays messages into the mailbox in order
 */
export function restoreMailboxQueue(runtime: AgentRuntime, queue: string[]): void {
  for (const message of queue) {
    runtime.mailbox.push(message);
  }
}

/**
 * Merge checkpoint state into running org
 * Used for resume operations to restore previous state
 *
 * NOT currently called from production code — daemon.ts's spawnRole builds
 * each role's mailbox inline (its own roleCheckpoint-driven restore logic,
 * duplicating the mailboxClosed/mailboxCloseReason handling below) rather
 * than calling this. Exercised today only by tests. If you change the
 * recoverable-close handling here, change it in daemon.ts's spawnRole too —
 * see isRecoverableCloseReason's doc comment in mailbox.ts.
 */
export function mergeCheckpoint(
  org: RunningOrg,
  checkpoint: OrgCheckpoint,
  restoreMailboxes: boolean = true,
  restorePolicy: boolean = true,
): void {
  // Restore each role's state from checkpoint
  for (const [roleId, roleState] of Object.entries(checkpoint.roleState)) {
    const runtime = org.agents.get(roleId);
    if (!runtime) continue; // Role no longer exists in org definition

    // Restore mailbox queue
    if (restoreMailboxes && roleState.mailboxQueue.length > 0) {
      restoreMailboxQueue(runtime, roleState.mailboxQueue);
    }

    // Restore mailbox closed state — EXCEPT for a recoverable close
    // (budget exhaustion): re-closing it here would mean the idle
    // watchdog's "raise the budget and resume from checkpoint" remedy
    // silently does nothing, since nothing in this codebase ever reopens a
    // closed mailbox otherwise. Leave it open so the resumed session can
    // actually receive its next message.
    if (
      roleState.mailboxClosed &&
      !runtime.mailbox.isClosed &&
      !isRecoverableCloseReason(roleState.mailboxCloseReason)
    ) {
      runtime.mailbox.close(roleState.mailboxCloseReason);
    }

    // Restore policy usage counters
    if (restorePolicy && roleState.tokensUsed > 0) {
      const currentUsage = runtime.policy.usage;
      const diff = roleState.tokensUsed - currentUsage;
      if (diff > 0) {
        runtime.policy.addUsage(diff);
      }
    }

    // Restore metadata
    runtime.metrics.costUsd = roleState.costUsd;
    runtime.lastMessageId = roleState.lastMessageId;
    runtime.status = roleState.status;
    if (roleState.error) runtime.error = roleState.error;
  }
}
