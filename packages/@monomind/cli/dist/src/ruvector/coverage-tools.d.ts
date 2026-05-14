/**
 * Coverage Router MCP Tools
 *
 * MCP tool implementations for coverage-aware routing.
 * Integrates with hooks_coverage_route and hooks_coverage_suggest from ruvector.
 */
import type { MCPTool } from '../mcp-tools/types.js';
/**
 * Coverage-aware routing MCP tool
 *
 * Routes tasks to optimal agents based on test coverage gaps.
 * Uses ruvector's hooks_coverage_route when available.
 */
export declare const hooksCoverageRoute: MCPTool;
/**
 * Coverage suggestions MCP tool
 *
 * Suggests which files need better coverage in a given path.
 * Uses ruvector's hooks_coverage_suggest when available.
 */
export declare const hooksCoverageSuggest: MCPTool;
/**
 * Coverage gaps MCP tool
 *
 * Lists all coverage gaps in the project with agent assignments.
 */
export declare const hooksCoverageGaps: MCPTool;
/**
 * All coverage router MCP tools
 */
export declare const coverageRouterTools: MCPTool[];
export default coverageRouterTools;
//# sourceMappingURL=coverage-tools.d.ts.map