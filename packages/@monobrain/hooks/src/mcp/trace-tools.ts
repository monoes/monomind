/**
 * Trace MCP Tools (GAP-010)
 *
 * MCP tools for querying the distributed trace store so Claude can inspect
 * what agents did, how long they took, and what tools they called.
 */

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

const DEFAULT_TRACE_PATH = '.monobrain/traces';

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
        description: 'Custom trace store path (default: .monobrain/traces)',
      },
    },
  },
  handler: async (input) => {
    const { TraceStore } = await import('../observability/index.js');
    const dir = (input.tracePath as string) || DEFAULT_TRACE_PATH;
    const limit = (input.limit as number) || 20;
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
        description: 'Custom trace store path (default: .monobrain/traces)',
      },
    },
    required: ['traceId'],
  },
  handler: async (input) => {
    const { TraceStore } = await import('../observability/index.js');
    const dir = (input.tracePath as string) || DEFAULT_TRACE_PATH;
    const store = new TraceStore(dir);
    const trace = store.getTrace(input.traceId as string);
    if (!trace) return { error: `Trace not found: ${input.traceId}` };
    return { trace };
  },
};

export const traceMCPTools: MCPTool[] = [listTracesTool, getTraceTool];
