export type DynamicImportPattern = {
    kind: 'string';
    value: string;
} | {
    kind: 'template';
    prefix: string;
    suffix: string;
} | {
    kind: 'expression';
};
export interface DynamicImportInfo {
    pattern: DynamicImportPattern;
    importedNames: string[];
    namespaceLocal?: string;
    isSideEffect: boolean;
    line: number;
}
export interface ResolvedDynamicImport {
    source: DynamicImportInfo;
    resolvedPaths: string[];
    isGlob: boolean;
}
/** Parse dynamic import calls from source text. */
export declare function parseDynamicImports(source: string): DynamicImportInfo[];
/** Expand a template-literal import to a glob pattern. */
export declare function templateToGlob(prefix: string, suffix: string): string;
/** Match a glob pattern against a list of file paths (simple prefix+suffix matching). */
export declare function matchGlob(pattern: string, files: string[]): string[];
/** Resolve a single dynamic import info against a list of known file paths. */
export declare function resolveSingleDynamicImport(info: DynamicImportInfo, allFiles: string[], currentDir: string): ResolvedDynamicImport;
//# sourceMappingURL=dynamic-imports.d.ts.map