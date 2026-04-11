import type { ClassifiedFile, ExtractionResult, BuildOptions } from '../types.js';
/**
 * Extract graph nodes and edges from all classified files.
 *
 * Reads each file, checks the on-disk cache keyed by SHA-256 content hash,
 * dispatches to the appropriate language extractor, and merges all results
 * into a single ExtractionResult (nodes deduplicated by id, edges by source+target+relation).
 *
 * @param files      - Classified files to process (from the classify layer)
 * @param outputDir  - Directory used for cache storage (.monobrain/graph by default)
 * @param options    - Build options (languages filter, maxFileSizeBytes, etc.)
 */
export declare function extractAll(files: ClassifiedFile[], outputDir: string, options?: BuildOptions): Promise<ExtractionResult>;
export type { LanguageExtractor } from './types.js';
export { typescriptExtractor } from './languages/typescript.js';
export { pythonExtractor } from './languages/python.js';
export { goExtractor } from './languages/go.js';
export { rustExtractor } from './languages/rust.js';
export { isTreeSitterAvailable, tryLoadParser, walk, parseFile, parseFileFromDisk } from './tree-sitter-runner.js';
//# sourceMappingURL=index.d.ts.map