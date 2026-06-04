/**
 * Coverage Router MCP Tools (ADR-017)
 *
 * Exposes coverage-aware routing over MCP: analyze test-coverage data, list gaps
 * with agent assignments, and suggest concrete test improvements. Thin wrappers
 * around `./coverage-router.js` (the shared pure logic also used by the
 * `monomind route coverage` CLI command).
 *
 * @module @monomind/cli/monovector/coverage-tools
 */
import type { MCPTool } from '../mcp-tools/types.js';
export declare const coverageRouterTools: MCPTool[];
export default coverageRouterTools;
//# sourceMappingURL=coverage-tools.d.ts.map