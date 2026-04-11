import type { BuildOptions, ClassifiedFile } from './types.js';
/**
 * Walks up the directory tree from rootPath to the filesystem root,
 * collecting patterns from any `.graphifyignore` files found along the way.
 * Lines beginning with `#` are comments; blank lines are skipped.
 * Returns the combined list of pattern strings (closest dir first).
 */
export declare function loadIgnorePatterns(rootPath: string): string[];
/**
 * Recursively collects and classifies all files under rootPath, applying
 * exclusion rules for directories, file size limits, security-sensitive filenames,
 * .graphifyignore patterns, and optional language filtering from BuildOptions.
 */
export declare function collectFiles(rootPath: string, options?: BuildOptions): ClassifiedFile[];
/**
 * Analyses a collected file corpus and returns a list of human-readable warning
 * strings describing potential issues. Returns an empty array when the corpus
 * looks healthy.
 */
export declare function corpusHealth(files: ClassifiedFile[]): string[];
//# sourceMappingURL=detect.d.ts.map