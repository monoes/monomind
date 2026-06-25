/**
 * Transfer MCP Tools
 * Pattern sharing via IPFS-based decentralized registry
 *
 * @module @monomind/cli/mcp-tools/transfer-tools
 * @version 3.0.0
 */

import type { MCPTool, MCPToolResult } from './types.js';

/**
 * Helper to create MCP tool result
 */
function createResult(data: unknown, isError = false): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

/**
 * Cached PatternStore — initialize() may open IPFS connections, sql.js/WASM,
 * or download registry data. Re-creating on every handler call wastes work
 * and risks file-descriptor / socket-pool leaks on rapid invocations.
 */
let cachedPatternStore: { initialize: () => Promise<unknown> } | null = null;
async function getPatternStore(): Promise<{ initialize: () => Promise<unknown>; [k: string]: unknown }> {
  if (cachedPatternStore) return cachedPatternStore as { initialize: () => Promise<unknown>; [k: string]: unknown };
  const { PatternStore } = await import('../transfer/store/index.js');
  const store = new PatternStore();
  await store.initialize();
  cachedPatternStore = store as unknown as { initialize: () => Promise<unknown> };
  return cachedPatternStore as { initialize: () => Promise<unknown>; [k: string]: unknown };
}

/**
 * Transfer MCP tools for pattern export, import, anonymization, and sharing
 */
export const transferTools: MCPTool[] = [
  // ═══════════════════════════════════════════════════════════════
  // ANONYMIZATION TOOLS
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'transfer_detect-pii',
    description: 'Detect PII in content without redacting',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Content to scan for PII',
        },
      },
      required: ['content'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { detectPII } = await import('../transfer/anonymization/index.js');
        // detectPII runs multiple PII regexes over the entire string — O(n × patterns).
        // Cap to 1 MB to prevent ReDoS-style DoS from oversized content.
        const MAX_PII_CONTENT_LEN = 1024 * 1024; // 1 MB
        const rawContent = (input as { content: string }).content;
        const content = typeof rawContent === 'string' && rawContent.length > MAX_PII_CONTENT_LEN
          ? rawContent.slice(0, MAX_PII_CONTENT_LEN) : rawContent;
        const result = detectPII(content);
        return createResult(result);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // IPFS TOOLS
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'transfer_ipfs-resolve',
    description: 'Resolve IPNS name to CID',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'IPNS name to resolve',
        },
      },
      required: ['name'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const { resolveIPNS } = await import('../transfer/ipfs/client.js');
        // Cap IPNS name length — uncapped strings may trigger O(n) path parsing
        // inside the IPFS client or be reflected in error messages.
        const MAX_IPNS_NAME_LEN = 512;
        const rawName = (input as { name: string }).name;
        const name = typeof rawName === 'string' && rawName.length > MAX_IPNS_NAME_LEN
          ? rawName.slice(0, MAX_IPNS_NAME_LEN) : rawName;
        const result = await resolveIPNS(name);
        return createResult({ success: true, cid: result });
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // PATTERN STORE TOOLS
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'transfer_store-search',
    description: 'Search the pattern store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        category: {
          type: 'string',
          description: 'Filter by category',
        },
        minRating: {
          type: 'number',
          description: 'Minimum rating',
        },
        verified: {
          type: 'boolean',
          description: 'Only show verified patterns',
        },
        limit: {
          type: 'number',
          description: 'Maximum results',
        },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const store = await getPatternStore() as unknown as InstanceType<typeof import('../transfer/store/index.js').PatternStore>;
        // Cap query and limit to prevent DoS via large string or result set.
        const MAX_TRANSFER_QUERY_LEN = 4 * 1024;
        const MAX_TRANSFER_LIMIT = 500;
        const inp = input as { query?: string; category?: string; minRating?: number; verified?: boolean; limit?: number };
        const cappedInput = {
          ...inp,
          query: typeof inp.query === 'string' && inp.query.length > MAX_TRANSFER_QUERY_LEN
            ? inp.query.slice(0, MAX_TRANSFER_QUERY_LEN) : inp.query,
          limit: typeof inp.limit === 'number' && Number.isFinite(inp.limit)
            ? Math.min(Math.floor(Math.max(inp.limit, 1)), MAX_TRANSFER_LIMIT) : inp.limit,
        };
        const results = store.search(cappedInput as Parameters<typeof store.search>[0]);
        return createResult(results);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer_store-info',
    description: 'Get detailed info about a pattern',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Pattern ID',
        },
      },
      required: ['id'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const store = await getPatternStore() as unknown as InstanceType<typeof import('../transfer/store/index.js').PatternStore>;
        const pattern = store.getPattern((input as { id: string }).id);
        if (!pattern) {
          return createResult({ error: 'Pattern not found' }, true);
        }
        return createResult(pattern);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer_store-download',
    description: 'Download a pattern from the store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Pattern ID',
        },
        verify: {
          type: 'boolean',
          description: 'Verify pattern integrity',
        },
      },
      required: ['id'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const store = await getPatternStore() as unknown as InstanceType<typeof import('../transfer/store/index.js').PatternStore>;
        const result = await store.download(
          (input as { id: string }).id,
          { verify: (input as { verify?: boolean }).verify }
        );
        return createResult(result);
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer_store-featured',
    description: 'Get featured patterns from the store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum results',
        },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const store = await getPatternStore() as unknown as InstanceType<typeof import('../transfer/store/index.js').PatternStore>;
        const featured = store.getFeatured();
        const limit = (input as { limit?: number }).limit || 10;
        return createResult(featured.slice(0, limit));
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

  {
    name: 'transfer_store-trending',
    description: 'Get trending patterns from the store',
    category: 'transfer',
    version: '1.0.0',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum results',
        },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      try {
        const store = await getPatternStore() as unknown as InstanceType<typeof import('../transfer/store/index.js').PatternStore>;
        const trending = store.getTrending();
        const limit = (input as { limit?: number }).limit || 10;
        return createResult(trending.slice(0, limit));
      } catch (error) {
        return createResult({ error: (error as Error).message }, true);
      }
    },
  },

];

export default transferTools;
