import type { BuildOptions, ClassifiedFile } from './types.js';
/**
 * Recursively collects and classifies all files under rootPath, applying
 * exclusion rules for directories, file size limits, and optional language
 * filtering from BuildOptions.
 */
export declare function collectFiles(rootPath: string, options?: BuildOptions): ClassifiedFile[];
//# sourceMappingURL=detect.d.ts.map