/**
 * Update executor - performs actual package updates
 * Includes rollback capability
 */
import { UpdateCheckResult } from './checker.js';
import { ValidationResult } from './validator.js';
export interface UpdateHistoryEntry {
    timestamp: string;
    package: string;
    fromVersion: string;
    toVersion: string;
    success: boolean;
    error?: string;
    rollbackAvailable: boolean;
}
export interface UpdateExecutionResult {
    success: boolean;
    package: string;
    version: string;
    error?: string;
    validation: ValidationResult;
}
export declare function loadHistory(): UpdateHistoryEntry[];
export declare function executeUpdate(update: UpdateCheckResult, installedPackages: Record<string, string>, dryRun?: boolean): Promise<UpdateExecutionResult>;
export declare function executeMultipleUpdates(updates: UpdateCheckResult[], installedPackages: Record<string, string>, dryRun?: boolean): Promise<UpdateExecutionResult[]>;
export declare function rollbackUpdate(packageName?: string): Promise<{
    success: boolean;
    message: string;
}>;
export declare function getUpdateHistory(limit?: number): UpdateHistoryEntry[];
export declare function clearHistory(): void;
//# sourceMappingURL=executor.d.ts.map