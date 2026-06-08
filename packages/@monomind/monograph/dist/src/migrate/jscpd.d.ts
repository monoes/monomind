export type { MigrationWarning } from './knip.js';
import type { MigrationWarning } from './knip.js';
export interface JscpdMigrationResult {
    monographConfig: Record<string, unknown>;
    warnings: MigrationWarning[];
    inputFile: string;
}
export declare function migrateFromJscpd(jscpdConfigPath: string): JscpdMigrationResult;
//# sourceMappingURL=jscpd.d.ts.map