/**
 * Causal Graph Analysis Tool - pr_causal_infer
 *
 * Analyzes causal graph structure to assess identifiability.
 * Identifies confounders, finds backdoor paths, and determines
 * whether a causal effect can be identified from the graph.
 * Does NOT estimate causal effect magnitude (that requires data).
 */
import type { MCPTool } from './types.js';
/**
 * pr_causal_infer MCP Tool Definition
 */
export declare const causalInferTool: MCPTool;
export default causalInferTool;
//# sourceMappingURL=causal-infer.d.ts.map