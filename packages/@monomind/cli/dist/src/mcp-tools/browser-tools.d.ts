/**
 * Browser MCP Tools
 *
 * Uses @monoes/monobrowse CDP client directly — no external binary required.
 * Sessions are keyed by session ID; each maps to a persistent CDP connection
 * on the configured port (default: MONOBROWSE_CDP_PORT env var or 9222).
 */
import type { MCPTool } from './types.js';
export declare const browserTools: MCPTool[];
export default browserTools;
//# sourceMappingURL=browser-tools.d.ts.map