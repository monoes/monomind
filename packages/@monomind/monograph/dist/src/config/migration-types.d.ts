export interface MigrationWarning {
    source: string;
    field: string;
    message: string;
    suggestion?: string;
}
export interface MigrationResult<T = unknown> {
    config: T;
    warnings: MigrationWarning[];
    sources: string[];
}
export type MigrationSourceKind = 'knip' | 'jscpd' | 'fallow' | 'auto';
export interface MigrationSource {
    kind: MigrationSourceKind;
    filePath: string;
}
export declare const KNIP_CONFIG_FILENAMES: readonly ["knip.json", "knip.jsonc", ".knip.json", ".knip.jsonc", "knip.ts", "knip.js", "knip.config.ts", "knip.config.js"];
export declare const JSCPD_CONFIG_FILENAMES: readonly [".jscpd.json", ".jscpd.yaml", ".jscpd.yml"];
export declare const KNOWN_KNIP_FIELDS: Set<string>;
export declare const KNOWN_JSCPD_FIELDS: Set<string>;
export declare function detectMigrationSource(dirPath: string, files: string[]): MigrationSource | null;
export declare function makeMigrationWarning(source: string, field: string, message: string, suggestion?: string): MigrationWarning;
export declare function migrationSuccess<T>(config: T, sources: string[], warnings?: MigrationWarning[]): MigrationResult<T>;
//# sourceMappingURL=migration-types.d.ts.map