/**
 * Transfer MCP Tools
 *
 * Only the PII scanner remains. A larger set of pattern-sharing tools
 * that used to live here was deleted along with the ~4,600-line subtree they
 * wrapped: they were unreachable three ways over — gated out of the default
 * MCP surface, exposed on a CLI path the dispatcher cannot reach (four levels
 * deep; the dispatcher handles three), and pointed at a registry whose
 * bootstrap config carried a placeholder public key rather than a real one.
 *
 * `transfer_detect-pii` is unrelated to all of that — it is a real regex PII
 * scanner over `src/transfer/anonymization/`, which has no dependency on the
 * deleted subtree, and it stays visible by default.
 *
 * @module @monomind/cli/mcp-tools/transfer-tools
 * @version 4.0.0
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

/** Ungated — internal/test use only. MCP clients get `transferTools` below. */
export const allTransferTools: MCPTool[] = [
  {
    name: 'transfer_detect-pii',
    description: 'Scan content for personally identifiable information with regex patterns and report what was found, without redacting it. Runs locally; no network or registry involved.',
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
];

// Nothing here is gated any more — the speculative tools this flag used to
// hide have been deleted outright. The export shape is kept so callers and the
// category loader continue to work unchanged.
export const transferTools: MCPTool[] = allTransferTools;

export default transferTools;
