import type { DirectoryScan, FileEntry, Fingerprint } from './types.js';
export interface ScanOptions {
    maxDepth?: number;
    ignorePatterns?: string[];
}
export declare function listFiles(root: string, options?: ScanOptions): FileEntry[];
export declare function scanDirectory(root: string, options?: ScanOptions): Promise<DirectoryScan>;
export declare function saveFingerprint(scan: DirectoryScan, monomindDir: string): Promise<void>;
export declare function loadFingerprint(monomindDir: string): Promise<Fingerprint | null>;
//# sourceMappingURL=scanner.d.ts.map