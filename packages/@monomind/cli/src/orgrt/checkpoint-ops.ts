// packages/@monomind/cli/src/orgrt/checkpoint-ops.ts
// Extracted from daemon.ts — replay, resume, branch checkpoint operations.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import { OrgBus } from './bus.js';
import { Mailbox } from './mailbox.js';
import { PolicyEngine } from './policy.js';
import { OrgDefSchema, ORG_DIR, type BusEvent, type OrgRole } from './types.js';
import { validateCheckpoint, isCheckpointExpired, restoreMailboxQueue, type OrgCheckpoint } from './checkpoint.js';
import type { OrgDaemon, RunningOrg, AgentRuntime, ScrollbackBuffer as ScrollbackBufferType } from './daemon.js';
import { ScrollbackBuffer, roleTokenBudget } from './daemon.js';

/** Time-travel debugging: replay from a specific checkpoint by run ID.
 *  Creates a fresh daemon instance and replays events from the target run's bus.jsonl. */
export async function replayFrom(daemon: OrgDaemon, name: string, run: string): Promise<RunningOrg | null> {
  const runDir = join(daemon.root, ORG_DIR, name, run);
  if (!existsSync(runDir)) return null;

  const busFile = join(runDir, 'bus.jsonl');
  if (!existsSync(busFile)) return null;

  // Create a replay org with a fresh run ID
  const replayRun = `replay-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const replayDir = join(daemon.root, ORG_DIR, name, replayRun);
  mkdirSync(replayDir, { recursive: true });

  // Read original events
  const events = readFileSync(busFile, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) as BusEvent; } catch { return null; } })
    .filter((e): e is BusEvent => e !== null);

  if (!events.length) return null;

  // Load org definition
  const defPath = join(daemon.root, ORG_DIR, `${name}.json`);
  if (!existsSync(defPath)) return null;

  const def = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));

  // Create replay bus
  const bus = new OrgBus(name, replayRun, replayDir);
  const MAX_COLLECTED = 1000;
  const collected: BusEvent[] = [];
  bus.subscribe(e => {
    const slim: BusEvent = e.data?.content != null
      ? { ...e, data: { ...e.data, content: undefined } }
      : e;
    collected.push(slim);
    if (collected.length > MAX_COLLECTED) collected.splice(0, collected.length - MAX_COLLECTED);
    for (const fn of daemon.globalSubscribers) fn(e);
  });

  const running: RunningOrg = { def, run: replayRun, bus, agents: new Map(), busEvents: () => [...collected] };

  // Reemit events into the replay bus with updated timestamps
  const startTime = Date.now();
  for (const e of events) {
    const replayEvent: BusEvent = { ...e, org: name, run: replayRun, ts: startTime };
    bus.emit(replayEvent);
  }

  daemon.orgs.set(name, running);
  bus.emit({ type: 'status', msg: `replay started from ${run} (${events.length} events replayed)` });
  daemon.persistState(name, 'running', replayRun);
  return running;
}

/** Resume a previous run from its checkpoint (runtime.json state). Reconstructs
 *  the org's agents and mailboxes from the persisted state, enabling time-travel
 *  debugging and run recovery after crashes. Returns the resumed RunningOrg or null.
 *  Pattern 3: Full state restoration including mailbox queues, policy counters,
 *  and session state with TTL and validation.
 *
 *  P2-13 status: the reconstructed AgentRuntime now carries the persisted SDK
 *  `sessionId` (restored below) and session.ts's runAgentSession honors it via
 *  `opts.resumeSessionId` — so the plumbing to actually resume the SDK
 *  conversation exists. BUT this function has no CLI caller today: `org
 *  replay`/`org resume-from` both route to `replayFrom` above (pure bus-event
 *  replay for debugging, no live session), not here, and nothing else in the
 *  codebase calls `daemon.resumeOrg`. Until a command wires spawnRole-equivalent
 *  session driving to the roles/pendingRoles this function reconstructs,
 *  "checkpoint resume" restores in-memory state but does not restart execution. */
export async function resumeOrg(daemon: OrgDaemon, name: string): Promise<RunningOrg | null> {
  const rtPath = join(daemon.root, ORG_DIR, name, 'runtime.json');
  if (!existsSync(rtPath)) {
    console.error('resumeOrg failed: runtime.json missing for', name);
    return null;
  }

  interface RuntimeState {
    status?: string;
    run?: string;
    checkpoint?: OrgCheckpoint;
    abandonedRoles?: string[];
  }

  let rt: RuntimeState | undefined;
  try {
    rt = JSON.parse(readFileSync(rtPath, 'utf8'));
  } catch (err) {
    console.error('resumeOrg failed: invalid JSON in runtime.json for', name, err instanceof Error ? err.message : err);
    return null;
  }

  // Allow resume from 'stopped' orgs - the checkpoint contains the running state to restore
  if (!rt?.run || !rt?.checkpoint) {
    console.error('resumeOrg failed: invalid runtime state for', name, 'status:', rt?.status, 'run:', rt?.run, 'checkpoint:', !!rt?.checkpoint);
    return null;
  }

  // Pattern 3: Checkpoint TTL validation - expire stale checkpoints
  if (rt.checkpoint && isCheckpointExpired(rt.checkpoint)) {
    console.error('resumeOrg failed: checkpoint expired for', name, 'updated:', rt.checkpoint.updated);
    return null;
  }

  // Pattern 3: Checksum validation - detect corrupted state
  if (rt.checkpoint && !validateCheckpoint(rt.checkpoint)) {
    console.error('resumeOrg failed: checkpoint validation failed for', name);
    return null;
  }

  // Load the org definition
  const defPath = join(daemon.root, ORG_DIR, `${name}.json`);
  if (!existsSync(defPath)) {
    console.error('resumeOrg failed: org definition missing for', name);
    return null;
  }

  const def = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));
  const dir = join(daemon.root, ORG_DIR, name, rt.run);

  // Check if run directory exists
  if (!existsSync(dir)) {
    console.error('resumeOrg failed: run directory missing', dir);
    return null;
  }

  // Reconstruct the bus from history
  const bus = new OrgBus(name, rt.run, dir);
  const MAX_COLLECTED = 1000;
  const collected: BusEvent[] = [];
  bus.subscribe(e => {
    const slim: BusEvent = e.data?.content != null
      ? { ...e, data: { ...e.data, content: undefined } }
      : e;
    collected.push(slim);
    if (collected.length > MAX_COLLECTED) collected.splice(0, collected.length - MAX_COLLECTED);
    for (const fn of daemon.globalSubscribers) fn(e);
  });

  const running: RunningOrg = { def, run: rt.run, bus, agents: new Map(), busEvents: () => [...collected] };

  // Pattern 3: Full checkpoint restoration - reconstruct agents with complete state
  if (rt.checkpoint) {
    const checkpoint = rt.checkpoint;

    // Reconstruct each role from checkpoint state
    for (const [roleId, roleState] of Object.entries(checkpoint.roleState)) {
      const role = def.roles.find(r => r.id === roleId);
      if (!role) continue; // Role no longer exists in org definition

      const mailbox = new Mailbox();
      const perRoleBudget = roleTokenBudget(role, def);
      const policy = new PolicyEngine(roleId, { maxTokens: perRoleBudget, ...(role.policy ?? {}) }, bus, daemon.root);

      const runtime: AgentRuntime = {
        mailbox,
        policy,
        status: roleState.status,
        done: Promise.resolve(),
        metrics: { tokens: roleState.tokensUsed, costUsd: roleState.costUsd },
        lastMessageId: roleState.lastMessageId,
        error: roleState.error,
        scrollback: new ScrollbackBuffer(),
        // P2-13: restore the persisted SDK session ID so the resumed role's
        // first query() call actually resumes the prior conversation instead
        // of starting cold — the checkpoint captured it, this consumes it.
        sessionId: roleState.sessionId,
      };

      // Restore scrollback from checkpoint if available
      if (roleState.scrollback?.length) {
        for (const line of roleState.scrollback) runtime.scrollback.push(line);
      }

      // Pattern 3: Restore mailbox queue content (not just closed state)
      if (roleState.mailboxQueue.length > 0) {
        restoreMailboxQueue(runtime, roleState.mailboxQueue);
      }

      // Pattern 3: Restore mailbox closed state
      if (roleState.mailboxClosed) {
        mailbox.close();
      }

      // Pattern 3: Restore policy usage counters
      if (roleState.tokensUsed > 0) {
        policy.setUsage(roleState.tokensUsed);
      }

      running.agents.set(roleId, runtime);
    }

    // Set up pending roles for lazy spawn (roles not in checkpoint)
    const reconstructedRoles = new Set(Object.keys(checkpoint.roleState));
    const pendingRoles = new Map<string, OrgRole>();
    for (const role of def.roles) {
      if (!reconstructedRoles.has(role.id)) {
        pendingRoles.set(role.id, role);
      }
    }
    if (pendingRoles.size > 0) {
      running.pendingRoles = pendingRoles;
    }
  }

  // Restore abandoned roles tracking
  if (rt.abandonedRoles) {
    daemon.abandoned.set(name, new Set(rt.abandonedRoles));
  }

  daemon.orgs.set(name, running);
  bus.emit({ type: 'status', msg: `org resumed from checkpoint (${rt.run})` });
  daemon.persistState(name, 'running', rt.run);
  return running;
}

/** Create a branch from a checkpoint for "what-if" experiments */
export function branchCheckpoint(daemon: OrgDaemon, name: string, run: string, branchName: string): { ok: true; branchRun: string } | { ok: false; error: string } {
  const runDir = join(daemon.root, ORG_DIR, name, run);
  if (!existsSync(runDir)) {
    return { ok: false, error: `run ${run} not found for org ${name}` };
  }

  const branchRun = `branch-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const branchDir = join(daemon.root, ORG_DIR, name, branchRun);

  try {
    mkdirSync(branchDir, { recursive: true });
    // Copy bus.jsonl to branch (C4: atomic — partial copy on crash leaves
    // a branch that can't replay its event log).
    const busFile = join(runDir, 'bus.jsonl');
    if (existsSync(busFile)) {
      const busContent = readFileSync(busFile, 'utf8');
      const branchBusFile = join(branchDir, 'bus.jsonl');
      // Atomic write for raw (non-JSON) content: tmp + rename.
      const tmp = `${branchBusFile}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, busContent, 'utf8');
      renameSync(tmp, branchBusFile);
    }
    // Create branch marker file (atomic)
    writeJsonFileAtomic(join(branchDir, '.branch-source'), { from: run, branchedAt: new Date().toISOString() });
    return { ok: true, branchRun };
  } catch (err) {
    return { ok: false, error: `failed to create branch: ${err instanceof Error ? err.message : String(err)}` };
  }
}
