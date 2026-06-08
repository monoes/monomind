import Parser from 'tree-sitter';
import type { LanguageConfig } from './language-config.js';
export declare function getParser(ext: string): Promise<{
    parser: Parser;
    config: LanguageConfig;
} | null>;
export declare function isSupportedExtension(ext: string): boolean;
export declare function getLanguageForExt(ext: string): string;
export interface ParseResult {
    nodes: import('../types.js').MonographNode[];
    edges: import('../types.js').MonographEdge[];
    parseErrors: string[];
}
export declare function parseFile(absolutePath: string, sourceText: string, repoRelativePath: string): Promise<ParseResult>;
//# sourceMappingURL=loader.d.ts.map