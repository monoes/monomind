export interface BoundaryRule {
    fromZone: string;
    toZone: string;
    allowed: boolean;
}
export interface PluginInfo {
    name: string;
    version: string;
    hooks: string[];
}
export interface ListOptions {
    format?: 'human' | 'json';
}
export declare function listBoundaries(config: {
    zones?: Array<{
        name: string;
        allowedDeps?: string[];
        deniedDeps?: string[];
    }>;
}): BoundaryRule[];
export declare function listPlugins(config: {
    plugins?: Array<{
        name: string;
        version?: string;
        hooks?: string[];
    }>;
}): PluginInfo[];
export declare function listEntryPoints(config: {
    entryPoints?: string[];
}): string[];
export declare function formatListHuman(items: Array<Record<string, unknown>>, columns: string[]): string;
//# sourceMappingURL=list.d.ts.map