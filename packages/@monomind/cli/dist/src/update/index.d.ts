/**
 * Auto-update system for @monomind packages
 *
 * Features:
 * - Rate-limited update checks (24h default)
 * - Automatic patch updates for security packages
 * - Compatibility validation before updates
 * - Rollback capability
 * - Update history logging
 */
export { checkForUpdates, checkSinglePackage, getInstalledVersion, DEFAULT_CONFIG, } from './checker.js';
export type { UpdateCheckResult, UpdateConfig } from './checker.js';
export { shouldCheckForUpdates, recordCheck, getCachedVersions, clearCache, loadState, } from './rate-limiter.js';
export type { RateLimitState } from './rate-limiter.js';
export { validateUpdate, validateBulkUpdate } from './validator.js';
export type { ValidationResult } from './validator.js';
export { executeUpdate, executeMultipleUpdates, rollbackUpdate, getUpdateHistory, clearHistory, loadHistory, } from './executor.js';
export type { UpdateHistoryEntry, UpdateExecutionResult } from './executor.js';
import type { UpdateCheckResult } from './checker.js';
/**
 * Synchronous — reads cached state from last check.
 * Returns a short inline string for the CLI version tagline, e.g.
 *   "  ↑ v1.11.12 available"
 *   "  ↑ v1.11.12 installing..."
 *   "  ✓ up to date"
 *   ""  (no cache yet)
 */
export declare function getUpdateTagline(currentVersion: string): string;
/**
 * Run auto-update check on startup
 * This is the main entry point for the auto-update system
 */
export declare function runStartupUpdateCheck(options: {
    verbose?: boolean;
    autoUpdate?: boolean;
    onInstalling?: (packages: string[]) => void;
}): Promise<{
    checked: boolean;
    updatesAvailable: UpdateCheckResult[];
    updatesApplied: string[];
    skippedReason?: string;
}>;
//# sourceMappingURL=index.d.ts.map