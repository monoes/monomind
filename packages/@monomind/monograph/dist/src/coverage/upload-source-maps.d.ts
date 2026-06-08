export interface UploadSourceMapsArgs {
    projectId: string;
    sourceDir: string;
    include?: string[];
    exclude?: string[];
    stripPath?: string;
    concurrency?: number;
    retries?: number;
    failFast?: boolean;
    apiKey?: string;
    apiBase?: string;
}
export interface SourceMapFile {
    originalPath: string;
    uploadPath: string;
    sizeBytes: number;
}
export interface UploadSourceMapsResult {
    uploaded: number;
    failed: number;
    skipped: number;
    warnings: string[];
}
/** Strip a path prefix from a file path. */
export declare function applyStripPath(filePath: string, strip: string): string;
/** Collect .map files from a directory (shallow heuristic — no actual fs walk in library mode). */
export declare function collectSourceMaps(files: string[], include?: string[], exclude?: string[], stripPath?: string): SourceMapFile[];
/** Upload source map files to the cloud API. */
export declare function uploadSourceMaps(args: UploadSourceMapsArgs, files: SourceMapFile[]): Promise<UploadSourceMapsResult>;
//# sourceMappingURL=upload-source-maps.d.ts.map