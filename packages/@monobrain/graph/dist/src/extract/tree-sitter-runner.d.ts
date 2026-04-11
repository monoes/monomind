import type { ExtractionResult } from '../types.js';
import type { LanguageExtractor } from './types.js';
type ParserInstance = {
    setLanguage(lang: unknown): void;
    parse(src: string): {
        rootNode: SyntaxNodeLike;
    };
};
export type SyntaxNodeLike = {
    type: string;
    text: string;
    startPosition: {
        row: number;
        column: number;
    };
    endPosition: {
        row: number;
        column: number;
    };
    children: SyntaxNodeLike[];
    childForFieldName(name: string): SyntaxNodeLike | null;
    descendantsOfType(type: string | string[]): SyntaxNodeLike[];
};
/**
 * Returns true when node-tree-sitter is installed and loadable.
 */
export declare function isTreeSitterAvailable(): boolean;
/**
 * Attempts to create a configured Parser for the given language identifier.
 * Returns null when tree-sitter or the grammar is not installed.
 */
export declare function tryLoadParser(language: string): ParserInstance | null;
export declare function walk(node: SyntaxNodeLike, visitor: (n: SyntaxNodeLike) => void): void;
/**
 * Parses a source file and delegates to the given LanguageExtractor.
 * The extractor receives the file path and raw content; it owns the AST
 * traversal internally (using tryLoadParser / walk from this module).
 *
 * Falls back gracefully: if tree-sitter cannot be loaded the extractor is still
 * called with the raw content and is expected to use its regex fallback.
 */
export declare function parseFile(filePath: string, content: string, extractor: LanguageExtractor): ExtractionResult;
/**
 * Convenience helper: read a file from disk and parse it.
 */
export declare function parseFileFromDisk(filePath: string, extractor: LanguageExtractor): ExtractionResult;
export {};
//# sourceMappingURL=tree-sitter-runner.d.ts.map