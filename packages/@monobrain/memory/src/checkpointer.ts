/**
 * SwarmCheckpointer — JSON-lines file-based graph checkpointing.
 *
 * Each checkpoint is appended as a single JSON line to a file,
 * similar to the CostTracker pattern used elsewhere in the project.
 * No native SQLite dependency required.
 */

import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import type { AgentState, SwarmCheckpoint, CheckpointMeta } from './types/checkpoint.js';

export type { AgentState, SwarmCheckpoint, CheckpointMeta };

/** Configuration accepted by the checkpointer constructor. */
export interface CheckpointerConfig {
  dbPath: string;
  swarmId: string;
  sessionId: string;
}

/**
 * Persists and retrieves full swarm checkpoints using a JSON-lines file.
 *
 * Each line in the file is a self-contained JSON object representing one
 * {@link SwarmCheckpoint}. Newest entries are always appended at the end.
 */
export class SwarmCheckpointer {
  private stepCounter = 0;
  private readonly dbPath: string;
  private readonly swarmId: string;
  private readonly sessionId: string;

  constructor(config: CheckpointerConfig) {
    this.dbPath = config.dbPath;
    this.swarmId = config.swarmId;
    this.sessionId = config.sessionId;
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  /** Read all checkpoints from the file (oldest-first). */
  private readAll(): SwarmCheckpoint[] {
    if (!existsSync(this.dbPath)) return [];
    const raw = readFileSync(this.dbPath, 'utf-8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line: string) => JSON.parse(line) as SwarmCheckpoint);
  }

  /** Overwrite the file with the given checkpoints. */
  private writeAll(checkpoints: SwarmCheckpoint[]): void {
    const data = checkpoints.map((c) => JSON.stringify(c)).join('\n') + (checkpoints.length ? '\n' : '');
    writeFileSync(this.dbPath, data, 'utf-8');
  }

  /** Compute a deterministic SHA-256 hash of the serialisable state. */
  private computeHash(
    agentStates: AgentState[],
    messageQueues: Record<string, unknown[]>,
    taskResults: Record<string, unknown>,
  ): string {
    const payload = JSON.stringify({ agentStates, messageQueues, taskResults });
    return createHash('sha256').update(payload).digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Save a full checkpoint of the entire swarm.
   *
   * @returns The generated `checkpointId`.
   */
  saveFull(
    agentStates: AgentState[],
    messageQueues: Record<string, unknown[]>,
    taskResults: Record<string, unknown>,
    trigger: SwarmCheckpoint['trigger'],
    parentCheckpointId?: string,
  ): string {
    const checkpointId = randomUUID();
    this.stepCounter += 1;

    const checkpoint: SwarmCheckpoint = {
      checkpointId,
      swarmId: this.swarmId,
      sessionId: this.sessionId,
      step: this.stepCounter,
      trigger,
      agentStates,
      messageQueues,
      taskResults,
      stateHash: this.computeHash(agentStates, messageQueues, taskResults),
      createdAt: new Date().toISOString(),
      parentCheckpointId,
    };

    appendFileSync(this.dbPath, JSON.stringify(checkpoint) + '\n', 'utf-8');
    return checkpointId;
  }

  /**
   * Save an incremental checkpoint that patches one agent's state.
   *
   * Loads the latest checkpoint, replaces (or appends) the given agent's
   * state, and writes a new checkpoint line.
   */
  saveIncremental(agentId: string, newState: AgentState): void {
    const prev = this.latest();
    const agentStates = prev ? [...prev.agentStates] : [];
    const idx = agentStates.findIndex((a) => a.agentId === agentId);
    if (idx >= 0) {
      agentStates[idx] = newState;
    } else {
      agentStates.push(newState);
    }

    const messageQueues = prev?.messageQueues ?? {};
    const taskResults = prev?.taskResults ?? {};

    this.saveFull(agentStates, messageQueues, taskResults, 'manual', prev?.checkpointId);
  }

  /**
   * Load a checkpoint by its ID.
   *
   * @returns The checkpoint, or `null` if not found.
   */
  load(checkpointId: string): SwarmCheckpoint | null {
    const all = this.readAll();
    return all.find((c) => c.checkpointId === checkpointId) ?? null;
  }

  /**
   * List checkpoint metadata, newest-first.
   *
   * @param limit Maximum number of entries to return (default 20).
   */
  list(limit = 20): CheckpointMeta[] {
    const all = this.readAll();
    return all
      .sort((a, b) => b.step - a.step)
      .slice(0, limit)
      .map((c) => ({
        checkpointId: c.checkpointId,
        swarmId: c.swarmId,
        sessionId: c.sessionId,
        step: c.step,
        trigger: c.trigger,
        agentCount: c.agentStates.length,
        stateHash: c.stateHash,
        createdAt: c.createdAt,
      }));
  }

  /**
   * Return the most recent checkpoint, or `null` if none exist.
   */
  latest(): SwarmCheckpoint | null {
    const all = this.readAll();
    if (all.length === 0) return null;
    return all.reduce((best, c) => (c.step > best.step ? c : best), all[0]);
  }

  /**
   * Compute the difference between two checkpoints in terms of agents.
   */
  diff(
    fromId: string,
    toId: string,
  ): { addedAgents: string[]; removedAgents: string[]; changedAgents: string[] } {
    const from = this.load(fromId);
    const to = this.load(toId);

    const fromIds = new Set((from?.agentStates ?? []).map((a) => a.agentId));
    const toIds = new Set((to?.agentStates ?? []).map((a) => a.agentId));

    const addedAgents = [...toIds].filter((id) => !fromIds.has(id));
    const removedAgents = [...fromIds].filter((id) => !toIds.has(id));

    const changedAgents: string[] = [];
    if (from && to) {
      for (const toAgent of to.agentStates) {
        if (!fromIds.has(toAgent.agentId)) continue; // added, not changed
        const fromAgent = from.agentStates.find((a) => a.agentId === toAgent.agentId);
        if (fromAgent && JSON.stringify(fromAgent) !== JSON.stringify(toAgent)) {
          changedAgents.push(toAgent.agentId);
        }
      }
    }

    return { addedAgents, removedAgents, changedAgents };
  }

  /**
   * Purge checkpoints older than the given number of days.
   *
   * @returns The number of checkpoints removed.
   */
  purge(olderThanDays = 7): number {
    const all = this.readAll();
    const cutoff = Date.now() - olderThanDays * 86_400_000;
    const kept = all.filter((c) => new Date(c.createdAt).getTime() > cutoff);
    const removed = all.length - kept.length;
    this.writeAll(kept);
    return removed;
  }
}
