/**
 * WASM Agent MCP Tools
 *
 * Exposes @ruvector/rvagent-wasm operations via MCP protocol.
 * All tools gracefully degrade when the WASM package is not installed.
 */

import type { MCPTool } from './types.js';

async function loadAgentWasm() {
  const mod = await import('../ruvector/agent-wasm.js');
  return mod;
}

export const wasmAgentTools: MCPTool[] = [
  {
    name: 'wasm_agent_create',
    description: 'Create a sandboxed WASM agent with virtual filesystem (no OS access). Optionally use a gallery template.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        template: { type: 'string', description: 'Gallery template name (coder, researcher, tester, reviewer, security, swarm)' },
        model: { type: 'string', description: 'Model identifier (default: anthropic:claude-sonnet-4-20250514)' },
        instructions: { type: 'string', description: 'System instructions for the agent' },
        maxTurns: { type: 'number', description: 'Max conversation turns (default: 50)' },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const wasm = await loadAgentWasm();
        if (args.template) {
          const info = await wasm.createAgentFromTemplate(args.template as string);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, agent: info, source: 'gallery' }, null, 2) }] };
        }
        const info = await wasm.createWasmAgent({
          model: args.model as string,
          instructions: args.instructions as string,
          maxTurns: args.maxTurns as number,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, agent: info }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'wasm_agent_prompt',
    description: 'Send a prompt to a WASM agent and get a response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'WASM agent ID' },
        input: { type: 'string', description: 'User prompt to send' },
      },
      required: ['agentId', 'input'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const wasm = await loadAgentWasm();
        const result = await wasm.promptWasmAgent(args.agentId as string, args.input as string);
        return { content: [{ type: 'text', text: result }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'wasm_agent_tool',
    description: 'Execute a tool on a WASM agent sandbox. Tools: read_file, write_file, edit_file, write_todos, list_files. Use flat format: {tool, path, content, ...}.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'WASM agent ID' },
        toolName: { type: 'string', description: 'Tool name (read_file, write_file, edit_file, write_todos, list_files)' },
        toolInput: { type: 'object', description: 'Tool parameters (flat: {path, content, old_string, new_string, todos})' },
      },
      required: ['agentId', 'toolName'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const wasm = await loadAgentWasm();
        // Flat format: {tool: 'write_file', path: '...', content: '...'}
        const toolCall = {
          tool: args.toolName as string,
          ...((args.toolInput as Record<string, unknown>) ?? {}),
        };
        const result = await wasm.executeWasmTool(args.agentId as string, toolCall);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'wasm_agent_list',
    description: 'List all active WASM agents.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      try {
        const wasm = await loadAgentWasm();
        const agents = wasm.listWasmAgents();
        return { content: [{ type: 'text', text: JSON.stringify({ agents, count: agents.length }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'wasm_agent_terminate',
    description: 'Terminate a WASM agent and free resources.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'WASM agent ID' },
      },
      required: ['agentId'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const wasm = await loadAgentWasm();
        const ok = wasm.terminateWasmAgent(args.agentId as string);
        return { content: [{ type: 'text', text: JSON.stringify({ success: ok }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'wasm_agent_files',
    description: 'Get a WASM agent\'s available tools and info.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'WASM agent ID' },
      },
      required: ['agentId'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const wasm = await loadAgentWasm();
        const tools = wasm.getWasmAgentTools(args.agentId as string);
        const info = wasm.getWasmAgent(args.agentId as string);
        return { content: [{ type: 'text', text: JSON.stringify({ tools, fileCount: info?.fileCount ?? 0, turnCount: info?.turnCount ?? 0 }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'wasm_agent_export',
    description: 'Export a WASM agent\'s full state (config, filesystem, conversation) as JSON.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'WASM agent ID' },
      },
      required: ['agentId'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const wasm = await loadAgentWasm();
        const state = wasm.exportWasmState(args.agentId as string);
        return { content: [{ type: 'text', text: state }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'wasm_gallery_list',
    description: 'List all available WASM agent gallery templates (Coder, Researcher, Tester, Reviewer, Security, Swarm).',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      try {
        const wasm = await loadAgentWasm();
        const templates = await wasm.listGalleryTemplates();
        return { content: [{ type: 'text', text: JSON.stringify({ templates, count: templates.length }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'wasm_gallery_search',
    description: 'Search WASM agent gallery templates by query.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const wasm = await loadAgentWasm();
        const results = await wasm.searchGalleryTemplates(args.query as string);
        return { content: [{ type: 'text', text: JSON.stringify({ results, count: results.length }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
  {
    name: 'wasm_gallery_create',
    description: 'Create a WASM agent from a gallery template.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        template: { type: 'string', description: 'Template name (coder, researcher, tester, reviewer, security, swarm)' },
      },
      required: ['template'],
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const wasm = await loadAgentWasm();
        const info = await wasm.createAgentFromTemplate(args.template as string);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, agent: info, template: args.template }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  },
];
