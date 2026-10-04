import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_SYSTEM_STORE_BYTES } from './system-tools-core.js';
import { getMonomindDataRoot, type MCPTool } from './types.js';

export const mcpStatusTool: MCPTool = {
  name: 'mcp_status',
  description: 'Get MCP server status from its runtime state and recorded PID',
  category: 'system',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    // The tool is also called locally by `monomind status`, where piped
    // stdin says nothing about whether an MCP server has started.
    const { getMCPServerStatus } = await import('../mcp-server.js');
    const status = await getMCPServerStatus();
    return {
      ...status,
      transport: status.transport ?? process.env.MONOMIND_MCP_TRANSPORT ?? 'stdio',
      port: status.transport === 'stdio' ? null : (status.port ?? null),
      host: status.transport === 'stdio' ? null : (status.host ?? null),
    };
  },
};

export const taskSummaryTool: MCPTool = {
  name: 'task_summary',
  description: 'Get a summary of all tasks by status',
  category: 'task',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    // Read from the task store file
    const storePath = join(getMonomindDataRoot(), 'tasks', 'store.json');
    let tasks: Array<{ status: string }> = [];
    try {
      if (existsSync(storePath) && statSync(storePath).size <= MAX_SYSTEM_STORE_BYTES) {
        const data = readFileSync(storePath, 'utf-8');
        const store = JSON.parse(data);
        tasks = Object.values(store.tasks || {});
      }
    } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[task_summary] failed to read/parse task store:', e);
    }

    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      running: tasks.filter((t) => t.status === 'in_progress').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
    };
  },
};
