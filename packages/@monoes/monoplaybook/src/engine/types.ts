export interface PlaybookDef {
  id: string;
  name: string;
  description?: string;
  params?: Record<string, { type?: string; required?: boolean; default?: unknown; description?: string }>;
  nodes: NodeDef[];
  connections: ConnectionDef[];
  /** Allow $env.* expressions to access env vars that match the secret denylist. Use with caution. */
  allowEnvAccess?: boolean;
}

export interface NodeDef {
  id: string;
  type: string;
  name?: string;
  config: Record<string, unknown>;
  onError?: 'skip' | 'stop';
  timeoutMs?: number;
}

export interface ConnectionDef {
  from: string;
  to: string;
  handle?: string; // port identifier for multi-output nodes (e.g. 'true'/'false' for core.if)
}

export interface Item {
  data: Record<string, unknown>;
  binaryBase64?: string; // base64-encoded binary payload
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface RunRecord {
  id: string;
  playbookId: string;
  playbookName: string;
  status: RunStatus;
  startedAt: number;
  completedAt?: number;
  itemsProcessed: number;
  itemsTotal: number;
  error?: string;
}

export interface StepEvent {
  runId: string;
  playbookId: string;
  playbookName: string;
  nodeId: string;
  nodeName: string;
  eventType: 'run_started' | 'step_started' | 'step_completed' | 'step_failed' | 'run_completed' | 'run_stopped' | 'run_failed';
  itemIndex?: number;
  itemTotal?: number;
  durationMs?: number;
  error?: string;
  timestamp: number;
  /** Absolute path of the project directory that emitted this event.
   *  Clients may subscribe to a specific project by passing `?dir=<path>`.
   *  Events without a projectDir are delivered to all clients (backward-compatible). */
  projectDir?: string;
}
