/**
 * CLI Analyze Command
 * Code analysis, diff classification, AST analysis, and change risk assessment
 *
 * Features:
 * - AST analysis using monovector (tree-sitter) with graceful fallback
 * - Symbol extraction (functions, classes, variables, types)
 * - Cyclomatic complexity scoring
 * - Diff classification and risk assessment
 * - Graph boundaries using MinCut algorithm
 * - Module communities using Louvain algorithm
 * - Circular dependency detection
 *
 * github.com/monoes/monomind
 */
import type { Command } from '../types.js';
export declare const analyzeCommand: Command;
export default analyzeCommand;
//# sourceMappingURL=analyze.d.ts.map