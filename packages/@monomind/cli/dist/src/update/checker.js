/**
 * Update checker for @monomind packages
 * Queries npm registry and compares versions
 */
import { createRequire } from 'module';
// Inline semver shim — avoids external dependency
const semver = {
  valid: (v) => /^\d+\.\d+\.\d+/.test(v || '') ? v : null,
  eq: (a, b) => a === b,
  major: (v) => parseInt((v || '0').split('.')[0], 10),
  minor: (v) => parseInt((v || '0').split('.')[1] || '0', 10),
  patch: (v) => parseInt(((v || '0').split('.')[2] || '0').replace(/[^0-9].*/, ''), 10),
};
import { reserveCheck, recordCheck, getCachedVersions } from './rate-limiter.js';
const require = createRequire(import.meta.url);
const DEFAULT_CONFIG = {
    enabled: true,
    checkIntervalHours: 24,
    autoUpdate: {
        patch: true,
        minor: false,
        major: false,
    },
    priority: {
        '@monomind/security': 'critical',
        '@monomind/cli': 'high',
    },
    exclude: [],
};
// Packages to check for updates
const MONOMIND_PACKAGES = [
    'monomind',
    '@monomind/cli',
];
// npm package name regex — covers plain names and @scope/name forms.
// Validates before using the name in URLs or filesystem paths.
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
function isValidNpmName(name) {
    return NPM_NAME_RE.test(name) && !name.includes('..') && name.length <= 214;
}
async function fetchPackageInfo(packageName) {
    if (!isValidNpmName(packageName))
        return null;
    try {
        const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            return null;
        }
        return (await response.json());
    }
    catch {
        return null;
    }
}
function getUpdateType(current, latest) {
    if (!semver.valid(current) || !semver.valid(latest)) {
        return 'none';
    }
    if (semver.eq(current, latest)) {
        return 'none';
    }
    if (semver.major(latest) > semver.major(current)) {
        return 'major';
    }
    if (semver.minor(latest) > semver.minor(current)) {
        return 'minor';
    }
    if (semver.patch(latest) > semver.patch(current)) {
        return 'patch';
    }
    return 'none';
}
function shouldAutoUpdate(updateType, priority, config) {
    if (updateType === 'none')
        return false;
    // Critical security packages always auto-update patches
    if (priority === 'critical' && updateType === 'patch') {
        return true;
    }
    // Check config
    if (updateType === 'major')
        return config.autoUpdate.major;
    if (updateType === 'minor')
        return config.autoUpdate.minor;
    if (updateType === 'patch')
        return config.autoUpdate.patch;
    return false;
}
export function getInstalledVersion(packageName) {
    if (!isValidNpmName(packageName))
        return null;
    try {
        // Try to find the package in node_modules
        const possiblePaths = [
            `${packageName}/package.json`,
            `../../node_modules/${packageName}/package.json`,
            `../../../node_modules/${packageName}/package.json`,
        ];
        for (const modulePath of possiblePaths) {
            try {
                // Use dynamic import with require for package.json
                const resolved = require.resolve(modulePath, { paths: [process.cwd()] });
                const pkg = require(resolved);
                return pkg.version;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
export async function checkForUpdates(config = DEFAULT_CONFIG) {
    // Check rate limit and atomically reserve this check slot
    const rateCheck = reserveCheck(config.checkIntervalHours);
    if (!rateCheck.allowed) {
        // Return cached results if available
        const cached = getCachedVersions();
        if (Object.keys(cached).length > 0) {
            return {
                results: [],
                skipped: true,
                reason: rateCheck.reason,
            };
        }
        return { results: [], skipped: true, reason: rateCheck.reason };
    }
    const results = [];
    const versionCache = {};
    // Check each package
    const packagesToCheck = MONOMIND_PACKAGES.filter((pkg) => !config.exclude.includes(pkg));
    // Sort by priority (critical first)
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    packagesToCheck.sort((a, b) => {
        const pa = config.priority[a] || 'normal';
        const pb = config.priority[b] || 'normal';
        return priorityOrder[pa] - priorityOrder[pb];
    });
    await Promise.all(packagesToCheck.map(async (packageName) => {
        const currentVersion = getInstalledVersion(packageName);
        if (!currentVersion) {
            // Package not installed, skip
            return;
        }
        const info = await fetchPackageInfo(packageName);
        if (!info) {
            return;
        }
        const latestVersion = info['dist-tags']?.latest;
        if (!latestVersion) {
            return;
        }
        versionCache[packageName] = latestVersion;
        const updateType = getUpdateType(currentVersion, latestVersion);
        const priority = config.priority[packageName] || 'normal';
        results.push({
            package: packageName,
            currentVersion,
            latestVersion,
            updateType,
            priority,
            shouldAutoUpdate: shouldAutoUpdate(updateType, priority, config),
        });
    }));
    // Record this check
    recordCheck(versionCache);
    // Filter to only updates available
    const updates = results.filter((r) => r.updateType !== 'none');
    return { results: updates, skipped: false };
}
export async function checkSinglePackage(packageName, config = DEFAULT_CONFIG) {
    if (!isValidNpmName(packageName))
        return null;
    const currentVersion = getInstalledVersion(packageName);
    if (!currentVersion) {
        return null;
    }
    const info = await fetchPackageInfo(packageName);
    if (!info) {
        return null;
    }
    const latestVersion = info['dist-tags']?.latest;
    if (!latestVersion) {
        return null;
    }
    const updateType = getUpdateType(currentVersion, latestVersion);
    const priority = config.priority[packageName] || 'normal';
    return {
        package: packageName,
        currentVersion,
        latestVersion,
        updateType,
        priority,
        shouldAutoUpdate: shouldAutoUpdate(updateType, priority, config),
    };
}
export { DEFAULT_CONFIG };
//# sourceMappingURL=checker.js.map