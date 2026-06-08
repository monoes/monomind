export interface IgnoreExportsUsedInFileByKind {
    interface: boolean;
    typeAlias: boolean;
}
export type IgnoreExportsUsedInFileConfig = {
    kind: 'disabled';
} | {
    kind: 'enabled';
} | {
    kind: 'byKind';
    byKind: IgnoreExportsUsedInFileByKind;
};
export declare const IGNORE_EXPORTS_DISABLED: IgnoreExportsUsedInFileConfig;
export declare const IGNORE_EXPORTS_ENABLED: IgnoreExportsUsedInFileConfig;
export declare function ignoreExportsByKind(byKind: IgnoreExportsUsedInFileByKind): IgnoreExportsUsedInFileConfig;
export declare function isIgnoreExportsEnabled(config: IgnoreExportsUsedInFileConfig): boolean;
export declare function suppressesExport(config: IgnoreExportsUsedInFileConfig, isTypeOnly: boolean): boolean;
export declare function parseIgnoreExportsConfig(raw: unknown): IgnoreExportsUsedInFileConfig;
//# sourceMappingURL=ignore-exports-used-in-file.d.ts.map