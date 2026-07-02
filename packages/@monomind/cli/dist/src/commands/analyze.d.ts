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
type AnalyzerModule = any;
export declare function getASTAnalyzer(): Promise<AnalyzerModule | null>;
export declare function getGraphAnalyzer(): Promise<AnalyzerModule | null>;
/**
 * Write analysis output to a file, constraining the path to the current working
 * directory to prevent path traversal attacks via --output /etc/cron.d/x or
 * similar. Throws if the resolved path escapes cwd.
 */
export declare function safeWriteOutputFile(outputFile: string, data: string): Promise<void>;
/**
 * Helper: Scan directory for source files
 */
export declare function scanSourceFiles(dir: string, maxDepth?: number): Promise<string[]>;
/**
 * Fallback analysis when monovector is not available
 */
export declare function fallbackAnalyze(code: string, filePath: string): {
    filePath: string;
    language: string;
    functions: {
        name: string;
        startLine: number;
        endLine: number;
    }[];
    classes: {
        name: string;
        startLine: number;
        endLine: number;
    }[];
    imports: string[];
    exports: string[];
    complexity: {
        cyclomatic: number;
        cognitive: number;
        loc: number;
        commentDensity: number;
    };
};
export declare const analyzeCommand: Command;
export default analyzeCommand;
//# sourceMappingURL=analyze.d.ts.map