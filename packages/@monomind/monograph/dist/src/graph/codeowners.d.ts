import type Database from 'better-sqlite3';
export interface CodeownersEntry {
    pattern: string;
    owners: string[];
}
export interface OwnershipResult {
    filePath: string;
    declaredOwners: string[];
    unowned: boolean;
}
export declare function parseCodeowners(repoRoot: string): CodeownersEntry[];
export interface CompiledEntry {
    owners: string[];
    re: RegExp;
}
/**
 * Compile an array of CodeownersEntry into CompiledEntry objects so that
 * globToRegex() runs exactly once per pattern instead of once per file lookup.
 */
export declare function compileEntries(entries: CodeownersEntry[]): CompiledEntry[];
export declare function resolveOwnerCompiled(compiled: CompiledEntry[], filePath: string): string[];
export declare function resolveOwner(entries: CodeownersEntry[], filePath: string): string[];
export declare function annotateOwnership(db: Database.Database, repoRoot: string): {
    annotated: number;
    unowned: number;
};
export declare function groupByOwner<T extends {
    filePath?: string | null;
}>(findings: T[], entries: CodeownersEntry[]): Map<string, T[]>;
//# sourceMappingURL=codeowners.d.ts.map