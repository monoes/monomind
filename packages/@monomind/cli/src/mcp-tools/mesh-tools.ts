/**
 * `mesh_*` — discovery and presence on the per-host Monomind Mesh hub.
 * Step 1 of docs/mastermind/specs/2026-10-23-monomind-mesh-design.md.
 */
import { z } from 'zod';
import { MeshOfflineError, callWithHub } from '../mesh/client.js';
import { WhoFilterSchema } from '../mesh/protocol.js';
import { projectIdFor } from '../mesh/project-id.js';
import { sessionPresence } from '../mesh/session-presence.js';
import { getProjectCwd } from '../utils/paths.js';
import type { MCPTool, MCPToolResult } from './types.js';

function toolError(error: string): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error }) }], isError: true };
}
function issues(e: z.ZodError): string {
  return `invalid input — ${e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`;
}

const JoinInput = z.object({
  alias: z.string().regex(/^[A-Za-z0-9._-]+$/).max(64).optional(),
  task: z.string().max(500).optional(),
  capabilities: z.array(z.string().min(1).max(64)).max(32).optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
});

const whoTool: MCPTool = {
  name: 'mesh_who',
  description:
    'List live Monomind agents on this host across all projects (sessions, subagents, org roles, ' +
    'external runtimes) with project, task and status. Filter by project, tier, status, ' +
    'capability, tag or parent. `offline: true` means the mesh hub is not running.',
  category: 'mesh',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Project id' },
      tier: { type: 'string', enum: ['session', 'subagent', 'org-role', 'external'] },
      status: { type: 'string', enum: ['active', 'stale', 'gone'] },
      capability: { type: 'string' },
      tag: { type: 'string' },
      parent: { type: 'string', description: 'Parent agent address' },
      includeGone: { type: 'boolean', description: 'Include agents that have left (default false)' },
    },
  },
  handler: async (input) => {
    const parsed = WhoFilterSchema.safeParse(input);
    if (!parsed.success) return toolError(issues(parsed.error));
    try {
      const r = await callWithHub({ op: 'who', id: `who-${Date.now()}`, ...parsed.data });
      return r.ok ? { agents: r.agents } : toolError(String(r.error));
    } catch (e) {
      if (e instanceof MeshOfflineError) return { offline: true, agents: [] };
      throw e;
    }
  },
};

const joinTool: MCPTool = {
  name: 'mesh_join',
  description:
    'Announce this session on the Monomind Mesh so other agents can discover it, and keep its ' +
    'presence alive while the session runs. Optionally set an alias, current task, capabilities and tags.',
  category: 'mesh',
  inputSchema: {
    type: 'object',
    properties: {
      alias: { type: 'string', description: 'Short unique name within the project, e.g. "lead"' },
      task: { type: 'string', description: 'What this session is working on' },
      capabilities: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
  handler: async (input) => {
    const parsed = JoinInput.safeParse(input);
    if (!parsed.success) return toolError(issues(parsed.error));
    const cwd = getProjectCwd();
    try {
      const addr = await sessionPresence.join({
        runtime: 'claude-code',
        pid: process.pid,
        project: projectIdFor(cwd),
        projectPath: cwd,
        sessionId: `s${process.pid}`,
        ...parsed.data,
      });
      return { addr };
    } catch (e) {
      if (e instanceof MeshOfflineError) return { offline: true };
      return toolError(e instanceof Error ? e.message : String(e));
    }
  },
};

const leaveTool: MCPTool = {
  name: 'mesh_leave',
  description: 'Remove this session from the Monomind Mesh and stop its heartbeat.',
  category: 'mesh',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    try {
      await sessionPresence.leave();
      return { left: true };
    } catch (e) {
      if (e instanceof MeshOfflineError) return { offline: true };
      throw e;
    }
  },
};

export const meshTools: MCPTool[] = [whoTool, joinTool, leaveTool];
