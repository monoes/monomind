export declare const INVENTORY_MAX_FUNCTIONS = 200000;
export interface InventoryFunction {
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
}
export interface UploadInventoryArgs {
    projectId: string;
    root: string;
    pathPrefix?: string;
    apiKey?: string;
    apiBase?: string;
    failOnDirty?: boolean;
}
export interface UploadInventoryResult {
    uploaded: number;
    skipped: number;
    warnings: string[];
}
/** Rebase container WORKDIR path prefix to repo-relative path. */
export declare function normalizePathPrefix(raw: string): string;
/** Attempt to derive a project ID slug from a git remote URL. */
export declare function parseGitRemoteToProjectId(url: string): string;
/** Extract function inventory from a source text (heuristic, no full AST). */
export declare function extractFunctionInventory(source: string, filePath: string): InventoryFunction[];
/** Upload a function inventory to the cloud API. */
export declare function uploadInventory(args: UploadInventoryArgs, functions: InventoryFunction[]): Promise<UploadInventoryResult>;
//# sourceMappingURL=upload-inventory.d.ts.map