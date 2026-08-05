/**
 * MCP Tool Types for CLI
 *
 * Local type definitions to avoid external imports outside package boundary.
 *
 * A1: path helpers (getProjectCwd / getMonomindDataRoot / migrateLegacyStoreFile)
 * used to be defined inline here, which inverted the dependency direction —
 * every layer (commands/, mcp-client.ts, monovector/, orgrt/) imported from
 * mcp-tools/ just to resolve the project root. They now live in
 * `utils/paths.ts` and are re-exported here so existing imports keep working.
 * New code should import from `../utils/paths.js` directly.
 */

// Re-export the path helpers for backward compatibility with existing callers
// that import from this module. New code should prefer `utils/paths.js`.
export { getProjectCwd, getMonomindDataRoot, migrateLegacyStoreFile } from '../utils/paths.js';

export interface MCPToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  category?: string;
  tags?: string[];
  version?: string;
  cacheable?: boolean;
  cacheTTL?: number;
  handler: (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<MCPToolResult | unknown>;
}
