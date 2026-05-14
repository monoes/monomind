/**
 * Analyze MCP Tools
 * Provides diff analysis and classification via MCP protocol
 */
import type { MCPTool } from './types.js';
/**
 * Diff Analysis Tool
 * Analyzes git diffs for change risk assessment and classification
 */
export declare const analyzeDiffTool: MCPTool;
/**
 * Diff Risk Assessment Tool
 * Focused risk assessment without full analysis
 */
export declare const diffRiskTool: MCPTool;
/**
 * Diff Classification Tool
 * Classify change type without full analysis
 */
export declare const diffClassifyTool: MCPTool;
/**
 * Diff Reviewers Tool
 * Suggest reviewers for changes
 */
export declare const diffReviewersTool: MCPTool;
/**
 * File Risk Tool
 * Assess risk for a specific file path
 */
export declare const fileRiskTool: MCPTool;
/**
 * Diff Stats Tool
 * Get quick diff statistics
 */
export declare const diffStatsTool: MCPTool;
export declare const analyzeTools: MCPTool[];
export default analyzeTools;
//# sourceMappingURL=analyze-tools.d.ts.map