export interface ExternalStyleImport {
    importingFile: string;
    stylePath: string;
    packageName: string;
}
export interface ExternalStyleScanResult {
    injectedEdges: ExternalStyleImport[];
    scannedFiles: number;
    skippedCycles: number;
}
/** Returns true if a path looks like a trackable external stylesheet. */
export declare function isTrackableExternalStylePath(path: string): boolean;
/** Extract the npm package name from a node_modules path. */
export declare function packageNameFromPath(path: string): string;
/** Scan @import statements in a stylesheet source, yielding resolved paths. */
export declare function scanStyleImports(source: string): string[];
/** Walk a list of resolved import paths and return synthetic external-style package edges. */
export declare function augmentExternalStylePackageUsage(importEdges: Array<{
    importingFile: string;
    resolvedPath: string;
}>, getSource?: (path: string) => string | undefined): ExternalStyleScanResult;
//# sourceMappingURL=external-style-usage.d.ts.map