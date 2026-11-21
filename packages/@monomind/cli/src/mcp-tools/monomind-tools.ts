/**
 * Monomind meta-tools — discovery for the (hidden-by-default) non-core roster.
 *
 * The default `tools/list` advertises only the core tool set (~20 tools) to
 * keep the per-call schema payload small. Non-core capabilities (browser,
 * github, claims, terminal, embeddings generation, etc.) are found through
 * `monomind_tool_search`, which returns their full inputSchema. Hosts that
 * only call listed tools cannot call them directly: run them with
 * `monomind mcp exec -t <tool>`, or set MONOMIND_MCP_FULL=1 to advertise the
 * entire roster instead.
 *
 * A2: the previous `import { searchNonCoreTools } from '../mcp-client.js'`
 * was a static cycle — mcp-client.ts lazy-imports monomind-tools.ts, and
 * monomind-tools.ts statically imported back from mcp-client.ts. The runtime
 * worked because the dynamic-import side breaks the loop, but any future
 * refactor that switched to a static import on the client side would break.
 * Switched to a dynamic import inside the handler so the cycle is broken
 * on both directions.
 */

import type { MCPTool } from './types.js';

export const monomindTools: MCPTool[] = [
  {
    name: 'monomind_tool_search',
    description:
      'Find hidden (non-advertised) monomind MCP tools by keyword. Hosts cannot call them directly; run one with `monomind mcp exec -t <tool>`.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keywords describing the capability you need (e.g. "open browser page", "create pull request", "list claims").',
        },
        category: {
          type: 'string',
          description:
            'Optional category prefix filter (e.g. browser, github, terminal, embeddings).',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const query = String(input.query ?? '');
      const category = input.category ? String(input.category) : undefined;
      const limit = Number(input.limit ?? 10);
      // A2: dynamic import breaks the static cycle (mcp-client.ts ↔
      // monomind-tools.ts). searchNonCoreTools depends on private state
      // (TOOL_REGISTRY, ensureAllLoaded, isCoreAdvertised) so it can't be
      // moved out of mcp-client.ts without exposing all of that.
      const { searchNonCoreTools } = await import('../mcp-client.js');
      const results = await searchNonCoreTools(query, category, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: results.length,
                note:
                  results.length === 0
                    ? 'No hidden tools matched. Set MONOMIND_MCP_FULL=1 on the MCP server to advertise the full roster, or rephrase the query.'
                    : 'These tools are not in the default tool list, so hosts that only call listed tools cannot call them. Run one with `monomind mcp exec -t <tool> -p <json>`, or set MONOMIND_MCP_FULL=1 on the MCP server to advertise them.',
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
