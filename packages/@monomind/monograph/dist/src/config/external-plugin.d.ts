export type EntryPointRole = 'productionSource' | 'testSource' | 'entryPoint' | 'configFile';
export interface ExternalUsedExport {
    symbol: string;
    scopeOverride?: string;
}
export interface ExternalEntryPoint {
    pattern: string;
    role: EntryPointRole;
}
export interface ExternalPluginDef {
    name: string;
    version: string;
    entryPoints: ExternalEntryPoint[];
    usedExports: ExternalUsedExport[];
    suppressPatterns: string[];
}
export declare const PLUGIN_MANIFEST_KEY = "monograph-plugin";
export declare function discoverExternalPlugins(root: string): ExternalPluginDef[];
export declare function mergePluginSuppressPatterns(plugins: ExternalPluginDef[]): string[];
//# sourceMappingURL=external-plugin.d.ts.map