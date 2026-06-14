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
export { shouldCheckForUpdates, recordCheck, getCachedVersions, clearCache, loadState, } from './rate-limiter.js';
export { validateUpdate, validateBulkUpdate } from './validator.js';
export { executeUpdate, executeMultipleUpdates, rollbackUpdate, getUpdateHistory, clearHistory, loadHistory, } from './executor.js';
// Re-export a convenience function for startup
import { checkForUpdates, DEFAULT_CONFIG, getInstalledVersion } from './checker.js';
import { executeMultipleUpdates } from './executor.js';
import { getCachedVersions } from './rate-limiter.js';
import * as semver from 'semver';
/**
 * Synchronous — reads cached state from last check.
 * Returns a short inline string for the CLI version tagline, e.g.
 *   "  ↑ v1.11.12 available"
 *   "  ↑ v1.11.12 installing..."
 *   "  ✓ up to date"
 *   ""  (no cache yet)
 */
export function getUpdateTagline(currentVersion) {
    try {
        const cached = getCachedVersions();
        // Compare CLI version against its own cached version only — the umbrella package
        // has a different version number and must not be used for this comparison.
        const latest = cached['@monoes/monomindcli'];
        if (!latest || !semver.valid(latest) || !semver.valid(currentVersion))
            return '';
        if (semver.lte(latest, currentVersion))
            return '  ✓ up to date';
        return `  ↑ v${latest} available`;
    }
    catch {
        return '';
    }
}
/**
 * Run auto-update check on startup
 * This is the main entry point for the auto-update system
 */
export async function runStartupUpdateCheck(options) {
    const result = {
        checked: false,
        updatesAvailable: [],
        updatesApplied: [],
        skippedReason: undefined,
    };
    try {
        const { results, skipped, reason } = await checkForUpdates(DEFAULT_CONFIG);
        if (skipped) {
            result.skippedReason = reason;
            return result;
        }
        result.checked = true;
        result.updatesAvailable = results;
        // Auto-update if enabled
        if (options.autoUpdate !== false) {
            const autoUpdateable = results.filter((r) => r.shouldAutoUpdate);
            if (autoUpdateable.length > 0) {
                // Notify caller before installation begins
                options.onInstalling?.(autoUpdateable.map(u => `${u.package}@${u.latestVersion}`));
                // Get current installed packages
                const installedPackages = {};
                for (const update of autoUpdateable) {
                    const version = getInstalledVersion(update.package);
                    if (version) {
                        installedPackages[update.package] = version;
                    }
                }
                // Execute updates
                const updateResults = await executeMultipleUpdates(autoUpdateable, installedPackages);
                result.updatesApplied = updateResults
                    .filter((r) => r.success)
                    .map((r) => `${r.package}@${r.version}`);
            }
        }
        return result;
    }
    catch {
        // Silently fail on startup - don't block CLI usage
        return result;
    }
}
//# sourceMappingURL=index.js.map