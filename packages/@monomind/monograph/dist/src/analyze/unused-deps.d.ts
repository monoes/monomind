export type DepCategory = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";
export interface UnusedDepResult {
    name: string;
    category: DepCategory;
    reason: string;
}
export interface UnresolvedImportResult {
    specifier: string;
    filePath: string;
}
export interface DepCategoryConfig {
    skipDev?: boolean;
    skipOptional?: boolean;
    skipPeer?: boolean;
}
export declare function findUnusedDependencies(usedPackages: Set<string>, declaredDeps: Record<DepCategory, string[]>, config?: DepCategoryConfig): UnusedDepResult[];
export declare function findUnresolvedImports(importSpecifiers: Array<{
    specifier: string;
    filePath: string;
}>, resolvedPackages: Set<string>): UnresolvedImportResult[];
export declare function findTypeOnlyDependencies(usedInProduction: Set<string>, usedInTypes: Set<string>, deps: string[]): string[];
//# sourceMappingURL=unused-deps.d.ts.map