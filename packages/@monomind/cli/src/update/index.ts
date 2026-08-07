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

export {
  checkForUpdates,
  checkSinglePackage,
  getInstalledVersion,
  DEFAULT_CONFIG,
} from './checker.js';

export type { UpdateCheckResult, UpdateConfig } from './checker.js';

export {
  shouldCheckForUpdates,
  recordCheck,
  getCachedVersions,
  clearCache,
  loadState,
} from './rate-limiter.js';

export type { RateLimitState } from './rate-limiter.js';

export { validateUpdate, validateBulkUpdate } from './validator.js';

export type { ValidationResult } from './validator.js';

export {
  executeUpdate,
  executeMultipleUpdates,
  rollbackUpdate,
  getUpdateHistory,
  clearHistory,
  loadHistory,
} from './executor.js';

export type { UpdateHistoryEntry, UpdateExecutionResult } from './executor.js';

// Re-export a convenience function for startup
import { checkForUpdates, DEFAULT_CONFIG } from './checker.js';
import type { UpdateCheckResult } from './checker.js';
import { getCachedVersions } from './rate-limiter.js';
// Inline semver shim — avoids external dependency (semver is not listed in package.json)
const semver = {
  valid: (v: string | null | undefined): string | null => /^\d+\.\d+\.\d+/.test(v || '') ? v! : null,
  gt: (a: string, b: string): boolean => {
    const [aMaj, aMin, aPat] = (a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const [bMaj, bMin, bPat] = (b || '0').split('.').map(n => parseInt(n, 10) || 0);
    return aMaj !== bMaj ? aMaj > bMaj : aMin !== bMin ? aMin > bMin : aPat > bPat;
  },
  lte: (a: string, b: string): boolean => {
    const [aMaj, aMin, aPat] = (a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const [bMaj, bMin, bPat] = (b || '0').split('.').map(n => parseInt(n, 10) || 0);
    if (aMaj !== bMaj) return aMaj < bMaj;
    if (aMin !== bMin) return aMin < bMin;
    return aPat <= bPat;
  },
};

/**
 * Synchronous — reads cached state from last check.
 * Returns a short inline string for the CLI version tagline, e.g.
 *   "  ↑ v1.11.12 available"
 *   "  ✓ up to date"
 *   ""  (no cache yet)
 */
export function getUpdateTagline(currentVersion: string): string {
  try {
    const cached = getCachedVersions();
    // Compare CLI version against its own cached version only — the umbrella package
    // has a different version number and must not be used for this comparison.
    const latest = cached['@monoes/monomindcli'];
    if (!latest || !semver.valid(latest) || !semver.valid(currentVersion)) return '';
    if (semver.lte(latest, currentVersion)) return '  ✓ up to date';
    return `  ↑ v${latest} available`;
  } catch {
    return '';
  }
}

/**
 * Run auto-update check on startup
 * This is the main entry point for the auto-update system
 */
export async function runStartupUpdateCheck(options: {
  verbose?: boolean;
  autoUpdate?: boolean;
  onInstalling?: (packages: string[]) => void;
}): Promise<{
  checked: boolean;
  updatesAvailable: UpdateCheckResult[];
  updatesApplied: string[];
  skippedReason?: string;
}> {
  const result = {
    checked: false,
    updatesAvailable: [] as UpdateCheckResult[],
    updatesApplied: [] as string[],
    skippedReason: undefined as string | undefined,
  };

  try {
    const { results, skipped, reason } = await checkForUpdates(DEFAULT_CONFIG);

    if (skipped) {
      result.skippedReason = reason;
      return result;
    }

    result.checked = true;
    result.updatesAvailable = results;

    // Notify-only: never auto-install on startup (GitHub issue #83).
    // The old code ran `npm install` with inherited cwd, silently modifying
    // the user's project package.json instead of updating the global CLI.
    // We still populate updatesAvailable so callers can display a message.

    return result;
  } catch {
    // Silently fail on startup - don't block CLI usage
    return result;
  }
}
