/**
 * Helpers Generator
 * Creates utility scripts in .claude/helpers/
 */
import type { InitOptions } from './types.js';
/**
 * Generate pre-commit hook script
 */
export declare function generatePreCommitHook(): string;
/**
 * Generate post-commit hook script
 */
export declare function generatePostCommitHook(): string;
/**
 * Generate session manager script
 */
export declare function generateSessionManager(): string;
/**
 * Generate agent router script
 */
export declare function generateAgentRouter(): string;
/**
 * Generate memory helper script
 */
export declare function generateMemoryHelper(): string;
/**
 * Generate hook-handler.cjs (cross-platform hook dispatcher)
 * This is the inline fallback when file copy from the package fails.
 * Uses string concatenation instead of template literals to avoid escaping issues.
 */
export declare function generateHookHandler(): string;
/**
 * Generate a minimal intelligence.cjs stub for fallback installs.
 * Provides the same API as the full intelligence.cjs but with simplified logic.
 * Gets overwritten when source copy succeeds (full version has PageRank, Jaccard, etc.)
 */
export declare function generateIntelligenceStub(): string;
/**
 * Generate a minimal auto-memory-hook.mjs fallback for fresh installs.
 * This ESM script handles import/sync/status commands gracefully when
 * @monoes/memory is not installed. Gets overwritten when source copy succeeds.
 */
export declare function generateAutoMemoryHook(): string;
/**
 * Generate Windows PowerShell daemon manager
 */
export declare function generateWindowsDaemonManager(): string;
/**
 * Generate Windows batch file wrapper
 */
export declare function generateWindowsBatchWrapper(): string;
/**
 * Generate cross-platform session manager
 */
export declare function generateCrossPlatformSessionManager(): string;
/**
 * Generate all helper files
 */
export declare function generateHelpers(options: InitOptions): Record<string, string>;
//# sourceMappingURL=helpers-generator.d.ts.map