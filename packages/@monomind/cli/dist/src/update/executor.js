/**
 * Update executor - performs actual package updates
 * Includes rollback capability
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateUpdate } from './validator.js';
// Inline semver shim — avoids external dependency (semver is not in package.json)
const semver = {
    valid: (v) => /^\d+\.\d+\.\d+/.test(v || '') ? v : null,
};
/**
 * Validate a npm package name.
 * Allows scoped (@scope/name) and unscoped names; rejects path-traversal,
 * shell metacharacters, and names that are too long to be legitimate.
 * See https://docs.npmjs.com/cli/v9/configuring-npm/package-json#name
 */
function isValidPackageName(name) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 214)
        return false;
    // Scoped: @scope/name — both parts: lowercase alnum + hyphens + underscores + dots
    if (name.startsWith('@')) {
        return /^@[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/.test(name);
    }
    // Unscoped: must not start with . or _ (legacy rule)
    return /^[a-z0-9][a-z0-9_.-]*$/.test(name);
}
/** Max bytes we will read from the on-disk update history file. */
const MAX_HISTORY_FILE_BYTES = 1 * 1024 * 1024; // 1 MB
function execFileAsync(cmd, args) {
    return new Promise((resolve, reject) => execFile(cmd, args, (err) => (err ? reject(err) : resolve())));
}
const HISTORY_FILE = path.join(os.homedir(), '.monomind', 'update-history.json');
const MAX_HISTORY_ENTRIES = 100;
function ensureDir() {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
export function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            // Guard against a bloated or attacker-crafted history file causing OOM.
            const stat = fs.statSync(HISTORY_FILE);
            if (stat.size > MAX_HISTORY_FILE_BYTES) {
                return [];
            }
            const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
            const raw = JSON.parse(content);
            if (!Array.isArray(raw))
                return [];
            // Sanitize each entry: reject any entry whose package name or version
            // fails validation so that a tampered history file cannot inject
            // arbitrary arguments into a subsequent npm install via rollbackUpdate().
            return raw.filter((e) => {
                if (typeof e !== 'object' || e === null)
                    return false;
                if (typeof e.package !== 'string' || !isValidPackageName(e.package))
                    return false;
                if (typeof e.fromVersion !== 'string' || !semver.valid(e.fromVersion))
                    return false;
                if (typeof e.toVersion !== 'string' || !semver.valid(e.toVersion))
                    return false;
                return true;
            });
        }
    }
    catch {
        // Corrupted file
    }
    return [];
}
function saveHistory(history) {
    ensureDir();
    // Keep only last N entries
    const trimmed = history.slice(-MAX_HISTORY_ENTRIES);
    const tmp = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
    fs.renameSync(tmp, HISTORY_FILE);
}
function recordUpdate(entry) {
    const history = loadHistory();
    history.push(entry);
    saveHistory(history);
}
export async function executeUpdate(update, installedPackages, dryRun = false) {
    // Validate first
    const validation = validateUpdate(update.package, update.currentVersion, update.latestVersion, installedPackages);
    if (!validation.valid) {
        return {
            success: false,
            package: update.package,
            version: update.latestVersion,
            error: `Validation failed: ${validation.incompatibilities.join(', ')}`,
            validation,
        };
    }
    if (dryRun) {
        return {
            success: true,
            package: update.package,
            version: update.latestVersion,
            validation,
        };
    }
    try {
        // Execute npm install — use execFile to avoid shell injection
        const pkg = update.package;
        const version = update.latestVersion;
        // Validate both package name and version before constructing the npm arg
        // to prevent argument injection via a crafted UpdateCheckResult.
        if (!isValidPackageName(pkg)) {
            throw new Error(`Invalid package name: ${pkg}`);
        }
        if (!semver.valid(version)) {
            throw new Error(`Invalid version: ${version}`);
        }
        await execFileAsync('npm', ['install', `${pkg}@${version}`, '--save-exact']);
        // Record successful update
        recordUpdate({
            timestamp: new Date().toISOString(),
            package: update.package,
            fromVersion: update.currentVersion,
            toVersion: update.latestVersion,
            success: true,
            rollbackAvailable: true,
        });
        return {
            success: true,
            package: update.package,
            version: update.latestVersion,
            validation,
        };
    }
    catch (error) {
        const err = error;
        // Record failed update
        recordUpdate({
            timestamp: new Date().toISOString(),
            package: update.package,
            fromVersion: update.currentVersion,
            toVersion: update.latestVersion,
            success: false,
            error: err.message,
            rollbackAvailable: false,
        });
        return {
            success: false,
            package: update.package,
            version: update.latestVersion,
            error: err.message,
            validation,
        };
    }
}
export async function executeMultipleUpdates(updates, installedPackages, dryRun = false) {
    const results = [];
    // Execute updates sequentially to avoid conflicts
    for (const update of updates) {
        const result = await executeUpdate(update, installedPackages, dryRun);
        results.push(result);
        // Update installed packages for next validation
        if (result.success) {
            installedPackages[update.package] = update.latestVersion;
        }
        // Stop on critical failures
        if (!result.success && update.priority === 'critical') {
            break;
        }
    }
    return results;
}
export async function rollbackUpdate(packageName) {
    const history = loadHistory();
    if (history.length === 0) {
        return { success: false, message: 'No update history available' };
    }
    // Find the last successful update for this package (or any if not specified)
    const reversed = [...history].reverse();
    const lastUpdate = packageName
        ? reversed.find((h) => h.package === packageName && h.success && h.rollbackAvailable)
        : reversed.find((h) => h.success && h.rollbackAvailable);
    if (!lastUpdate) {
        return {
            success: false,
            message: packageName
                ? `No rollback available for ${packageName}`
                : 'No rollback available',
        };
    }
    try {
        // Install the previous version — use execFile to avoid shell injection
        const pkg = lastUpdate.package;
        const version = lastUpdate.fromVersion;
        if (!semver.valid(version)) {
            throw new Error(`Invalid version: ${version}`);
        }
        await execFileAsync('npm', ['install', `${pkg}@${version}`, '--save-exact']);
        // Record the rollback
        recordUpdate({
            timestamp: new Date().toISOString(),
            package: lastUpdate.package,
            fromVersion: lastUpdate.toVersion,
            toVersion: lastUpdate.fromVersion,
            success: true,
            rollbackAvailable: false, // Can't rollback a rollback
        });
        return {
            success: true,
            message: `Rolled back ${lastUpdate.package} from ${lastUpdate.toVersion} to ${lastUpdate.fromVersion}`,
        };
    }
    catch (error) {
        const err = error;
        return {
            success: false,
            message: `Rollback failed: ${err.message}`,
        };
    }
}
export function getUpdateHistory(limit = 20) {
    const history = loadHistory();
    return history.slice(-limit).reverse();
}
export function clearHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        fs.unlinkSync(HISTORY_FILE);
    }
}
//# sourceMappingURL=executor.js.map