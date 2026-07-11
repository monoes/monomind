/**
 * Monograph MCP Tools
 *
 * Native TypeScript code intelligence — replaces Python graphify.
 * All monograph_* tools are backed by @monoes/monograph package.
 */
import type { MCPTool } from './types.js';
/**
 * Full tool list regardless of gating — used by the graphify compat shims,
 * which must resolve targets (e.g. monograph_community) even when the
 * advanced set is not exposed over MCP.
 */
export declare const allMonographTools: MCPTool[];
export declare const monographTools: MCPTool[];
//# sourceMappingURL=monograph-tools.d.ts.map