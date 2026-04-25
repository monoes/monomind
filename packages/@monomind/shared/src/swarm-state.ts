/**
 * TypedDict Swarm State with Reducer Annotations.
 * Defines the canonical state shape shared across all swarm agents.
 */

// ---------------------------------------------------------------------------
// Reducer name union
// ---------------------------------------------------------------------------
export type ReducerName =
  | 'append'
  | 'last_write'
  | 'merge_unique'
  | 'raft_merge'
  | 'deep_merge';

// ---------------------------------------------------------------------------
// Generic annotated field
// ---------------------------------------------------------------------------
export interface SwarmStateField<T> {
  value: T;
  reducer: ReducerName;
  schema?: unknown;
}

// ---------------------------------------------------------------------------
// Domain value types
// ---------------------------------------------------------------------------
export interface Message {
  id: string;
  fromAgent: string;
  toAgent?: string;
  content: unknown;
  timestamp: Date;
}

export interface Finding {
  agentSlug: string;
  taskId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  file?: string;
  line?: number;
}

export interface AgentError {
  agentSlug: string;
  taskId: string;
  error: string;
  retryCount: number;
  timestamp: Date;
}

export interface ConsensusVote {
  protocol: 'raft' | 'byzantine' | 'gossip';
  term?: number;
  leader?: string;
  votes: Array<{ agentId: string; vote: boolean }>;
  committed: boolean;
}

// ---------------------------------------------------------------------------
// Top-level SwarmState
// ---------------------------------------------------------------------------
export interface SwarmState {
  messages: SwarmStateField<Message[]>;
  findings: SwarmStateField<Finding[]>;
  errors: SwarmStateField<AgentError[]>;
  consensus: SwarmStateField<ConsensusVote | null>;
  metadata: SwarmStateField<Record<string, unknown>>;
  taskResults: SwarmStateField<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createDefaultSwarmState(): SwarmState {
  return {
    messages: { value: [], reducer: 'append' },
    findings: { value: [], reducer: 'append' },
    errors: { value: [], reducer: 'append' },
    consensus: { value: null, reducer: 'raft_merge' },
    metadata: { value: {}, reducer: 'deep_merge' },
    taskResults: { value: {}, reducer: 'deep_merge' },
  };
}
