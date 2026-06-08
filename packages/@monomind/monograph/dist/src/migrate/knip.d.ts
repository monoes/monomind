export interface MigrationWarning {
    field: string;
    message: string;
    knipValue: unknown;
}
export interface KnipMigrationResult {
    monographConfig: Record<string, unknown>;
    warnings: MigrationWarning[];
    inputFile: string;
}
export declare function migrateFromKnip(knipConfigPath: string): KnipMigrationResult;
export declare function stripJsoncComments(input: string): string;
export declare function parseJsoncString(input: string): Record<string, unknown>;
export declare function generateTomlFromMigration(config: Record<string, unknown>): string;
//# sourceMappingURL=knip.d.ts.map