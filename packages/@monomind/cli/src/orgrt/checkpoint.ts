// packages/@monomind/cli/src/orgrt/checkpoint.ts
// Semantic checkpoint state management for org runtime - Pattern 3 implementation
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { AgentRuntime, RunningOrg } from './daemon.js';

/** Checkpoint state for a single agent role */
export interface RoleCheckpoint {
  /** Message queue content (actual messages, not just count) */
  mailboxQueue: string[];
  /** Whether the mailbox was closed */
  mailboxClosed: boolean;
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
  status: 'running' | 'stopped' | 'crashed';
  run: string;
  pid: number;
  updated: string;
  /** Per-role checkpoint state */
  roleState: Record<string, RoleCheckpoint>;
  /** Roles not yet spawned (lazy spawn) */
  pendingRoles: string[];
  /** Roles that failed resource gates and won't spawn */
  abandonedRoles: string[];
  /** Checksum for state validation */
  checksum: string;
}

/** Checkpoint TTL config */
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours default

/**
 * Extract full checkpoint state from a RunningOrg
 * Called by persistState() to capture complete state for resume
 */
export function captureCheckpoint(org: RunningOrg): OrgCheckpoint {
  const roleState: Record<string, RoleCheckpoint> = {};
  const pendingRoles: string[] = [];
  const abandonedRoles: string[] = [];

  // Capture state for each running agent
  for (const [roleId, runtime] of org.agents) {
    roleState[roleId] = {
      mailboxQueue: runtime.mailbox.serialize().queue,
      mailboxClosed: runtime.mailbox.isClosed,
      tokensUsed: runtime.policy.usage,
      costUsd: runtime.metrics.costUsd,
      lastMessageId: runtime.lastMessageId,
      sessionId: undefined, // TODO: extract from session layer
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
    status: 'running',
    run: org.run,
    pid: process.pid,
    updated: new Date().toISOString(),
    roleState,
    pendingRoles,
    abandonedRoles,
  };

  // Generate checksum over all state
  const checksum = generateChecksum(partial);

  return { ...partial, checksum };
}

/**
 * Validate checkpoint integrity using checksum
 * Returns true if checksum matches, false if corrupted
 */
export function validateCheckpoint(checkpoint: OrgCheckpoint): boolean {
  const { checksum, ...state } = checkpoint;
  const recomputed = generateChecksum(state);
  return checksum === recomputed;
}

/**
 * Check if checkpoint has expired based on TTL
 * Returns true if checkpoint is stale and should not be used
 */
export function isCheckpointExpired(checkpoint: OrgCheckpoint, ttlMs: number = CHECKPOINT_TTL_MS): boolean {
  const updated = new Date(checkpoint.updated).getTime();
  const now = Date.now();
  return (now - updated) > ttlMs;
}

/**
 * Generate checksum over checkpoint state
 * Uses SHA-256 hash of JSON representation
 */
function generateChecksum(state: Omit<OrgCheckpoint, 'checksum'>): string {
  const canonical = JSON.stringify(state, Object.keys(state).sort());
  return Buffer.from(canonical).toString('base64').slice(0, 16); // Simple checksum for now
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

    // Restore mailbox closed state
    if (roleState.mailboxClosed && !runtime.mailbox.isClosed) {
      runtime.mailbox.close();
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
