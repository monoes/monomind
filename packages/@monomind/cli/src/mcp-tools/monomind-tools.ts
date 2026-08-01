/**
 * Monomind meta-tools — discovery for the (hidden-by-default) non-core roster.
 *
 * The default `tools/list` advertises only the core tool set (~80 tools) to
 * keep the per-call schema payload small. Non-core capabilities (browser,
 * github, swarm, claims, terminal, embeddings generation, etc.) remain fully
 * callable but are found through `monomind_tool_search`, which returns their
 * full inputSchema so the model can call them directly. Set
 * MONOMIND_MCP_FULL=1 to advertise the entire roster instead.
 */

import type { MCPTool } from './types.js';
import { searchNonCoreTools } from '../mcp-client.js';

export const monomindTools: MCPTool[] = [
  {
    name: 'monomind_tool_search',
    description:
      'Discover hidden (non-advertised) monomind MCP tools by keyword. Returns each match\'s full inputSchema so the tool can be called directly.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords describing the capability you need (e.g. "open browser page", "create pull request", "swarm topology").',
        },
        category: {
          type: 'string',
          description: 'Optional category prefix filter (e.g. browser, github, swarm, terminal, embeddings).',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const query = String(input.query ?? '');
      const category = input.category ? String(input.category) : undefined;
      const limit = Number(input.limit ?? 10);
      const results = await searchNonCoreTools(query, category, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: results.length,
                note: results.length === 0
                  ? 'No hidden tools matched. Set MONOMIND_MCP_FULL=1 on the MCP server to advertise the full roster, or rephrase the query.'
                  : 'Call any returned tool directly by name — it is callable even though it is not in the default tool list.',
                tools: results,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
];

export default monomindTools;
