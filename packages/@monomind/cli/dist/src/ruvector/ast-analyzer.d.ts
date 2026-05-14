/**
 * AST Analyzer for Code Analysis
 *
 * Analyzes Abstract Syntax Trees for code understanding
 * and intelligent routing decisions.
 *
 * @module ast-analyzer
 */
export interface ASTAnalyzerConfig {
    maxFileSize: number;
    languages: string[];
    includeComments: boolean;
    extractTypes: boolean;
    maxDepth: number;
}
export interface ASTNode {
    type: string;
    name: string;
    startLine: number;
    endLine: number;
    children: ASTNode[];
    metadata?: Record<string, unknown>;
}
export interface ASTAnalysis {
    filePath: string;
    language: string;
    root: ASTNode;
    functions: ASTNode[];
    classes: ASTNode[];
    imports: string[];
    exports: string[];
    complexity: {
        cyclomatic: number;
        cognitive: number;
        loc: number;
        commentDensity: number;
    };
    timestamp: number;
    durationMs: number;
}
export declare class ASTAnalyzer {
    private config;
    private ruvectorEngine;
    private useNative;
    private analysisCache;
    constructor(config?: Partial<ASTAnalyzerConfig>);
    initialize(): Promise<void>;
    analyze(code: string, filePath?: string): ASTAnalysis;
    getFunctionAtLine(analysis: ASTAnalysis, line: number): ASTNode | null;
    getClassAtLine(analysis: ASTAnalysis, line: number): ASTNode | null;
    getSymbols(analysis: ASTAnalysis): string[];
    getStats(): Record<string, number>;
    clearCache(): void;
    private getCacheKey;
    private detectLanguage;
    private parseAST;
    private matchFunction;
    private matchClass;
    private findBlockEnd;
    private extractFunctions;
    private extractClasses;
    private extractImports;
    private extractExports;
    private calculateComplexity;
}
export declare function createASTAnalyzer(config?: Partial<ASTAnalyzerConfig>): ASTAnalyzer;
//# sourceMappingURL=ast-analyzer.d.ts.map