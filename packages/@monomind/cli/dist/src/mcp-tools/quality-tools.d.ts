/**
 * Quality Tools — built-in quality MCP tools
 *
 * Wraps 2 tools: coverage gap prioritization and secret detection.
 *
 * monolean: 14 tools were removed — their handlers fabricated results
 * (hardcoded fake file coverage, Math.random()-driven projections/predictions,
 * invented defect data, fake security scan findings, hardcoded compliance
 * results) rather than performing real analysis. Only prioritize-gaps
 * (salvageable) and detect-secrets (real) remain.
 */
import type { MCPTool } from './types.js';
export declare const qualityTools: MCPTool[];
//# sourceMappingURL=quality-tools.d.ts.map