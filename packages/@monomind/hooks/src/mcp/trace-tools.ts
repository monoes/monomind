/**
 * Trace MCP Tools (GAP-010)
 *
 * MCP tools for querying the distributed trace store so Claude can inspect
 * what agents did, how long they took, and what tools they called.
 */

import { resolve } from 'node:path';
import { cwd } from 'node:process';

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

const DEFAULT_TRACE_PATH = '.monomind/traces';

// ── Security helpers ──────────────────────────────────────────────────────────

/**
 * Validate a caller-supplied trace store directory path.
 *
 * Without this check an attacker can pass `tracePath: "../../../../etc"` and
 * TraceStore will happily read files from that directory.  Only paths that
 * resolve to a descendant of the current working directory are accepted.
 */
function validateTracePath(raw: string | undefined): string {
  const projectRoot = resolve(cwd());
  const candidate = resolve(projectRoot, raw ?? DEFAULT_TRACE_PATH);

  if (!candidate.startsWith(projectRoot + '/') && candidate !== projectRoot) {
    throw new Error('tracePath must be within the project directory');
  }
  if (candidate.length > 4096) {
    throw new Error('tracePath too long (max 4096 characters)');
  }
  return candidate;
}

/**
 * Validate a trace ID.
 *
 * Trace IDs are used in filesystem lookups and `.find()` comparisons inside
 * TraceStore.  An unbounded string here enables O(n) linear scan DoS.
 * Allow only safe alphanumeric + common separator characters.
 */
function validateTraceId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('traceId must be a non-empty string');
  }
  if (raw.length > 256) {
    throw new Error('traceId too long (max 256 characters)');
  }
  if (!/^[\w.:-]+$/.test(raw)) {
    throw new Error('traceId contains invalid characters');
  }
  return raw;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const MAX_TRACE_LIST_LIMIT = 1000;

export const listTracesTool: MCPTool = {
  name: 'hooks/traces/list',
  description: 'List recent distributed traces showing agent activity, task descriptions, and status.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of traces to return (default: 20)',
        default: 20,
      },
      tracePath: {
        type: 'string',
        description: 'Custom trace store path (default: .monomind/traces)',
      },
    },
  },
  handler: async (input) => {
    let dir: string;
    try {
      dir = validateTracePath(input.tracePath as string | undefined);
    } catch (e) {
      return { error: (e as Error).message };
    }
    // Cap list limit to prevent DoS from O(n) directory scan.
    const rawLimit = (input.limit as number) || 20;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_TRACE_LIST_LIMIT) : 20;
    const { TraceStore } = await import('../observability/index.js');
    const store = new TraceStore(dir);
    const traces = store.listRecentTraces(limit);
    return { traces, count: traces.length };
  },
};

export const getTraceTool: MCPTool = {
  name: 'hooks/traces/get',
  description: 'Get a full trace by ID including all spans and tool calls.',
  inputSchema: {
    type: 'object',
    properties: {
      traceId: {
        type: 'string',
        description: 'The trace ID to retrieve',
      },
      tracePath: {
        type: 'string',
        description: 'Custom trace store path (default: .monomind/traces)',
      },
    },
    required: ['traceId'],
  },
  handler: async (input) => {
    let dir: string;
    let traceId: string;
    try {
      dir = validateTracePath(input.tracePath as string | undefined);
      traceId = validateTraceId(input.traceId);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const { TraceStore } = await import('../observability/index.js');
    const store = new TraceStore(dir);
    const trace = store.getTrace(traceId);
    if (!trace) return { error: `Trace not found: ${traceId}` };
    return { trace };
  },
};

export const traceMCPTools: MCPTool[] = [listTracesTool, getTraceTool];
