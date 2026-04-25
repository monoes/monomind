/** SQL DDL for cost tracking table */
export const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS agent_cost_records (
  id            TEXT PRIMARY KEY,
  agent_slug    TEXT NOT NULL,
  task_type     TEXT,
  task_id       TEXT,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd      REAL,
  latency_ms    INTEGER,
  retry_count   INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
)
`;

export const CREATE_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_cost_agent_slug ON agent_cost_records(agent_slug)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_task_type  ON agent_cost_records(task_type)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_created_at ON agent_cost_records(created_at)`,
];

export interface CostRecord {
  id?: string;
  agentSlug: string;
  taskType?: string;
  taskId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  latencyMs?: number;
  retryCount?: number;
  createdAt?: string;
}
