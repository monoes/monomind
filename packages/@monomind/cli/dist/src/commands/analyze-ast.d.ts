/**
 * Analyze AST subcommand
 * AST-based code analysis using monovector tree-sitter with regex fallback
 */
import type { Command } from '../types.js';
/**
 * Helper: Truncate file path for display
 */
export declare function truncatePathAst(filePath: string, maxLen?: number): string;
/**
 * Helper: Format complexity value with color coding
 */
export declare function formatComplexityValueAst(value: number): string;
/**
 * Helper: Get type marker for symbols
 */
export declare function getTypeMarkerAst(type: string): string;
/**
 * Helper: Get complexity rating text
 */
export declare function getComplexityRatingAst(value: number): string;
/**
 * AST analysis subcommand
 */
export declare const astCommand: Command;
//# sourceMappingURL=analyze-ast.d.ts.map