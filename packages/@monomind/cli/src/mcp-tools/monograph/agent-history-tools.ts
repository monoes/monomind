import { randomUUID } from 'crypto';
import type { MCPTool } from '../types.js';
import { getDbPath, text } from './shared.js';

// ── monograph_agent_history ─────────────────────────────────────────────────

export const monographAgentHistoryTool: MCPTool = {
  name: 'monograph_agent_history',
  description: 'Query past agent interactions by org, type, session, or time range. Returns rows ordered by timestamp descending.',
  inputSchema: {
    type: 'object',
    properties: {
      org_name: { type: 'string', description: 'Filter by org name' },
      agent_type: { type: 'string', description: 'Filter by agent type' },
      session_id: { type: 'string', description: 'Filter by session id' },
      since: { type: 'number', description: 'Unix timestamp (ms) — only interactions after this time' },
      limit: { type: 'number', description: 'Max rows to return (default 50)' },
    },
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (typeof input.org_name === 'string') {
        conditions.push('org_name = @org_name');
        params.org_name = input.org_name;
      }
      if (typeof input.agent_type === 'string') {
        conditions.push('agent_type = @agent_type');
        params.agent_type = input.agent_type;
      }
      if (typeof input.session_id === 'string') {
        conditions.push('session_id = @session_id');
        params.session_id = input.session_id;
      }
      if (typeof input.since === 'number') {
        conditions.push('timestamp >= @since');
        params.since = input.since;
      }

      const MAX_LIMIT = 1_000;
      const rawLimit = (input.limit as number | undefined) ?? 50;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
        : 50;
      params.limit = limit;

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT * FROM agent_interactions ${where} ORDER BY timestamp DESC LIMIT @limit`;
      const rows = db.prepare(sql).all(params);
      if (rows.length === 0) return text('No agent interactions found.');
      return text(JSON.stringify(rows, null, 2));
    } finally { closeDb(db); }
  },
};

// ── monograph_agent_patterns ────────────────────────────────────────────────

export const monographAgentPatternsTool: MCPTool = {
  name: 'monograph_agent_patterns',
  description: 'Aggregate agent interaction patterns: success rates, costs, and token usage grouped by agent type, org, or session.',
  inputSchema: {
    type: 'object',
    properties: {
      group_by: {
        type: 'string',
        description: "Column to group by: 'agent_type' | 'org_name' | 'session_id'",
      },
      since: { type: 'number', description: 'Unix timestamp (ms) — only interactions after this time' },
      min_count: { type: 'number', description: 'Minimum interaction count to include in results (default 2)' },
    },
    required: ['group_by'],
  },
  handler: async (input) => {
    const groupBy = input.group_by as string;
    const ALLOWED_GROUP_COLUMNS = new Set(['agent_type', 'org_name', 'session_id']);
    if (!ALLOWED_GROUP_COLUMNS.has(groupBy)) {
      return text(`Invalid group_by: ${groupBy}. Must be one of: agent_type, org_name, session_id`);
    }

    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const params: Record<string, unknown> = {};
      const conditions: string[] = [];
      if (typeof input.since === 'number') {
        conditions.push('timestamp >= @since');
        params.since = input.since;
      }
      const minCount = typeof input.min_count === 'number' && input.min_count > 0
        ? Math.floor(input.min_count)
        : 2;
      params.min_count = minCount;

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `
        SELECT
          ${groupBy} AS group_key,
          COUNT(*) AS interaction_count,
          AVG(success) AS success_rate,
          SUM(tokens_in) AS total_tokens_in,
          SUM(tokens_out) AS total_tokens_out,
          SUM(cost_usd) AS total_cost_usd,
          AVG(duration_ms) AS avg_duration_ms
        FROM agent_interactions
        ${where}
        GROUP BY ${groupBy}
        HAVING COUNT(*) >= @min_count
        ORDER BY interaction_count DESC
      `;
      const rows = db.prepare(sql).all(params);
      if (rows.length === 0) return text('No agent interaction patterns found.');
      return text(JSON.stringify(rows, null, 2));
    } finally { closeDb(db); }
  },
};

// ── monograph_agent_record ──────────────────────────────────────────────────

export const monographAgentRecordTool: MCPTool = {
  name: 'monograph_agent_record',
  description: 'Record an agent interaction (called by capture hooks).',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'Session id' },
      agent_type: { type: 'string', description: 'Agent type' },
      org_name: { type: 'string', description: 'Org name' },
      parent_agent: { type: 'string', description: 'Parent agent name/type, if spawned by another agent' },
      prompt_summary: { type: 'string', description: 'Short summary of the prompt given to the agent' },
      result_summary: { type: 'string', description: 'Short summary of the agent result' },
      tokens_in: { type: 'number', description: 'Input tokens consumed (default 0)' },
      tokens_out: { type: 'number', description: 'Output tokens produced (default 0)' },
      cost_usd: { type: 'number', description: 'Cost in USD (default 0)' },
      success: { type: 'boolean', description: 'Whether the interaction succeeded (default true)' },
      duration_ms: { type: 'number', description: 'Duration in milliseconds (default 0)' },
    },
    required: ['session_id', 'agent_type'],
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const id = randomUUID();
      const timestamp = Date.now();
      db.prepare(`
        INSERT INTO agent_interactions (
          id, session_id, org_name, agent_type, parent_agent,
          prompt_summary, result_summary, tokens_in, tokens_out,
          cost_usd, success, duration_ms, timestamp
        ) VALUES (
          @id, @session_id, @org_name, @agent_type, @parent_agent,
          @prompt_summary, @result_summary, @tokens_in, @tokens_out,
          @cost_usd, @success, @duration_ms, @timestamp
        )
      `).run({
        id,
        session_id: input.session_id as string,
        org_name: (input.org_name as string | undefined) ?? null,
        agent_type: input.agent_type as string,
        parent_agent: (input.parent_agent as string | undefined) ?? null,
        prompt_summary: (input.prompt_summary as string | undefined) ?? null,
        result_summary: (input.result_summary as string | undefined) ?? null,
        tokens_in: (input.tokens_in as number | undefined) ?? 0,
        tokens_out: (input.tokens_out as number | undefined) ?? 0,
        cost_usd: (input.cost_usd as number | undefined) ?? 0,
        success: (input.success as boolean | undefined) === false ? 0 : 1,
        duration_ms: (input.duration_ms as number | undefined) ?? 0,
        timestamp,
      });
      return text(`Recorded agent interaction ${id} for ${input.agent_type as string} at ${timestamp}`);
    } finally { closeDb(db); }
  },
};
