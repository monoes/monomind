export type EntryPointCategory = "all" | "runtime" | "test";
export type EntryPointSource = 'package-json-main' | 'package-json-bin' | 'package-json-exports' | 'tsconfig' | 'workspace' | 'config' | 'manual';
export interface CategorizedEntryPoints {
    all: string[];
    runtime: string[];
    test: string[];
}
export declare const OUTPUT_DIRS: string[];
export declare function isTestEntryPoint(filePath: string): boolean;
export declare function categorizeEntryPoints(entryPoints: string[]): CategorizedEntryPoints;
export declare function formatSkippedEntryWarning(filePath: string, reason: string): string;
export declare function deduplicateEntryPoints(entries: string[]): string[];
//# sourceMappingURL=entry-points.d.ts.map