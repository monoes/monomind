/**
 * Package validator for update compatibility
 * Ensures updates don't break the ecosystem
 */
// Inline semver shim — avoids external dependency (semver is not listed in package.json)
const semver = {
    valid: (v) => /^\d+\.\d+\.\d+/.test(v || '') ? v : null,
    major: (v) => parseInt((v || '0').split('.')[0], 10),
    gt: (a, b) => {
        const [aMaj, aMin, aPat] = (a || '0').split('.').map(n => parseInt(n, 10) || 0);
        const [bMaj, bMin, bPat] = (b || '0').split('.').map(n => parseInt(n, 10) || 0);
        return aMaj !== bMaj ? aMaj > bMaj : aMin !== bMin ? aMin > bMin : aPat > bPat;
    },
    lt: (a, b) => {
        const [aMaj, aMin, aPat] = (a || '0').split('.').map(n => parseInt(n, 10) || 0);
        const [bMaj, bMin, bPat] = (b || '0').split('.').map(n => parseInt(n, 10) || 0);
        return aMaj !== bMaj ? aMaj < bMaj : aMin !== bMin ? aMin < bMin : aPat < bPat;
    },
};
// Maximum number of updates accepted in a single validateBulkUpdate call.
// Without this cap a caller can DoS the validator by passing thousands of
// update entries — each entry triggers validateUpdate which iterates over
// COMPATIBILITY_MATRIX and BREAKING_CHANGES.
const MAX_BULK_UPDATES = 50;
// Version strings must look like semver (major.minor.patch with optional pre-release)
// before we use them in string interpolation or comparisons.
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
// Package names: scoped (@scope/name) or plain, no shell-special chars.
const PKG_NAME_RE = /^(@[a-zA-Z0-9][a-zA-Z0-9_.-]*\/)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
function isSafeVersion(v) {
    return typeof v === 'string' && v.length <= 64 && SEMVER_RE.test(v);
}
function isSafePackageName(p) {
    return typeof p === 'string' && p.length <= 200 && PKG_NAME_RE.test(p);
}
// Known compatibility matrix between monomind packages
const COMPATIBILITY_MATRIX = {
    '@monomind/cli': {},
    '@monoes/monomindcli': {
        'monofence-ai': { minVersion: '1.0.0' },
    },
    'monomind': {
        '@monoes/monomindcli': { minVersion: '1.11.0' },
    },
};
// Known breaking changes by version
const BREAKING_CHANGES = {
    'monomind': {
        '2.0.0': [
            'CLI commands renamed from monomind:* to mastermind:*',
            'Memory API changed from key-value to vector-based',
            'Hooks system redesigned with 17 hook types',
        ],
    },
    '@monoes/monomindcli': {
        '2.0.0': [
            'Agent spawning now requires type parameter',
            'Swarm topology options changed',
        ],
    },
};
export function validateUpdate(packageName, fromVersion, toVersion, installedPackages) {
    const result = {
        valid: true,
        incompatibilities: [],
        warnings: [],
        requiredPeerUpdates: [],
    };
    // Guard inputs: reject untrusted or malformed strings before they flow into
    // error messages or semver comparisons (which assume well-formed input).
    if (!isSafePackageName(packageName)) {
        result.valid = false;
        result.incompatibilities.push('Invalid package name');
        return result;
    }
    if (!isSafeVersion(fromVersion) || !isSafeVersion(toVersion)) {
        result.valid = false;
        result.incompatibilities.push('Invalid version string(s)');
        return result;
    }
    // Check if this is a major version bump
    if (semver.valid(fromVersion) && semver.valid(toVersion)) {
        const fromMajor = semver.major(fromVersion);
        const toMajor = semver.major(toVersion);
        if (toMajor > fromMajor) {
            result.warnings.push(`Major version update (${fromMajor} → ${toMajor}) may contain breaking changes`);
            // Check for known breaking changes
            const changes = BREAKING_CHANGES[packageName]?.[`${toMajor}.0.0`];
            if (changes) {
                result.warnings.push(`Known breaking changes in v${toMajor}:`);
                changes.forEach((change) => result.warnings.push(`  - ${change}`));
            }
        }
    }
    // Check compatibility with installed packages
    const compatibility = COMPATIBILITY_MATRIX[packageName];
    if (compatibility) {
        for (const [depName, depReq] of Object.entries(compatibility)) {
            const installedVersion = installedPackages[depName];
            if (installedVersion) {
                // Check minimum version
                if (semver.valid(installedVersion) &&
                    semver.lt(installedVersion, depReq.minVersion)) {
                    result.incompatibilities.push(`${packageName}@${toVersion} requires ${depName} >= ${depReq.minVersion} (installed: ${installedVersion})`);
                    result.requiredPeerUpdates.push(`${depName}@>=${depReq.minVersion}`);
                    result.valid = false;
                }
                // Check maximum version
                if (depReq.maxVersion &&
                    semver.valid(installedVersion) &&
                    semver.gt(installedVersion, depReq.maxVersion)) {
                    result.warnings.push(`${packageName}@${toVersion} may not be compatible with ${depName}@${installedVersion} (max: ${depReq.maxVersion})`);
                }
            }
        }
    }
    // Check reverse compatibility - other packages that depend on this one
    for (const [pkgName, deps] of Object.entries(COMPATIBILITY_MATRIX)) {
        if (pkgName === packageName)
            continue;
        const depInfo = deps[packageName];
        if (depInfo && installedPackages[pkgName]) {
            // If the target version is below what the installed package needs
            if (semver.valid(toVersion) && semver.lt(toVersion, depInfo.minVersion)) {
                result.incompatibilities.push(`${pkgName}@${installedPackages[pkgName]} requires ${packageName} >= ${depInfo.minVersion}`);
                result.valid = false;
            }
        }
    }
    return result;
}
export function validateBulkUpdate(updates, currentPackages) {
    const combinedResult = {
        valid: true,
        incompatibilities: [],
        warnings: [],
        requiredPeerUpdates: [],
    };
    // Cap the number of updates to prevent DoS via large arrays
    if (!Array.isArray(updates) || updates.length > MAX_BULK_UPDATES) {
        combinedResult.valid = false;
        combinedResult.incompatibilities.push(`Too many updates: max ${MAX_BULK_UPDATES} allowed per call`);
        return combinedResult;
    }
    // Create a simulated state after all updates
    const simulatedPackages = { ...currentPackages };
    for (const update of updates) {
        simulatedPackages[update.package] = update.to;
    }
    // Validate each update against the final state
    for (const update of updates) {
        const result = validateUpdate(update.package, update.from, update.to, simulatedPackages);
        if (!result.valid) {
            combinedResult.valid = false;
        }
        combinedResult.incompatibilities.push(...result.incompatibilities);
        combinedResult.warnings.push(...result.warnings);
        combinedResult.requiredPeerUpdates.push(...result.requiredPeerUpdates);
    }
    // Deduplicate
    combinedResult.incompatibilities = [...new Set(combinedResult.incompatibilities)];
    combinedResult.warnings = [...new Set(combinedResult.warnings)];
    combinedResult.requiredPeerUpdates = [...new Set(combinedResult.requiredPeerUpdates)];
    return combinedResult;
}
//# sourceMappingURL=validator.js.map