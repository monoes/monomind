/**
 * Graph Checkpointing Types (Task 08)
 *
 * Defines the shape of agent snapshots, full swarm checkpoints,
 * and lightweight checkpoint metadata used for listing / diffing.
 */

/** Snapshot of a single agent at checkpoint time. */
export interface AgentState {
  agentId: string;
  agentSlug: string;
  status: 'active' | 'idle' | 'completed' | 'failed';
  messageHistory: unknown[];
  toolCallStack: unknown[];
  taskId?: string;
  metadata: Record<string, unknown>;
  snapshotAt: string;
}

/** Full swarm checkpoint containing every agent's state + queues + results. */
export interface SwarmCheckpoint {
  checkpointId: string;
  swarmId: string;
  sessionId: string;
  step: number;
  trigger: 'post-task' | 'session-end' | 'manual' | 'interrupt' | 'periodic';
  agentStates: AgentState[];
  messageQueues: Record<string, unknown[]>;
  consensusState?: unknown;
  taskResults: Record<string, unknown>;
  stateHash: string;
  createdAt: string;
  parentCheckpointId?: string;
}

/** Lightweight metadata returned by list(). */
export interface CheckpointMeta {
  checkpointId: string;
  swarmId: string;
  sessionId: string;
  step: number;
  trigger: string;
  agentCount: number;
  stateHash: string;
  createdAt: string;
}
