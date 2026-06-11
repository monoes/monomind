/**
 * Update checker for @monomind packages
 * Queries npm registry and compares versions
 */

import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import * as semver from 'semver';
import { reserveCheck, recordCheck, getCachedVersions } from './rate-limiter.js';

const require = createRequire(import.meta.url);

export interface UpdateCheckResult {
  package: string;
  currentVersion: string;
  latestVersion: string;
  updateType: 'major' | 'minor' | 'patch' | 'none';
  shouldAutoUpdate: boolean;
  priority: 'critical' | 'high' | 'normal' | 'low';
  changelog?: string;
}

export interface UpdateConfig {
  enabled: boolean;
  checkIntervalHours: number;
  autoUpdate: {
    patch: boolean;
    minor: boolean;
    major: boolean;
  };
  priority: Record<string, 'critical' | 'high' | 'normal' | 'low'>;
  exclude: string[];
}

const DEFAULT_CONFIG: UpdateConfig = {
  enabled: true,
  checkIntervalHours: 24,
  autoUpdate: {
    patch: true,
    minor: true,
    major: false,
  },
  priority: {
    'monofence-ai': 'critical',
    '@monoes/monomindcli': 'high',
    'monomind': 'high',
    '@monoes/monograph': 'normal',
    '@monoes/memory': 'normal',
    '@monoes/monodesign': 'low',
  },
  exclude: [],
};

// All monomind-ecosystem packages to check for updates.
// getInstalledVersion() returns null for uninstalled packages — they are silently skipped.
const MONOMIND_PACKAGES = [
  'monomind',
  '@monoes/monomindcli',
  'monofence-ai',
  '@monoes/monograph',
  '@monoes/memory',
  '@monoes/monodesign',
  '@monomind/guidance',
  '@monomind/hooks',
  '@monomind/mcp',
  '@monomind/routing',
];

// npm package name regex — covers plain names and @scope/name forms.
// Validates before using the name in URLs or filesystem paths.
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

function isValidNpmName(name: string): boolean {
  return NPM_NAME_RE.test(name) && !name.includes('..') && name.length <= 214;
}

interface NpmPackageInfo {
  'dist-tags': { latest: string };
  versions: Record<string, unknown>;
}

async function fetchPackageInfo(packageName: string): Promise<NpmPackageInfo | null> {
  if (!isValidNpmName(packageName)) return null;
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as NpmPackageInfo;
  } catch {
    return null;
  }
}

function getUpdateType(
  current: string,
  latest: string
): 'major' | 'minor' | 'patch' | 'none' {
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

function shouldAutoUpdate(
  updateType: 'major' | 'minor' | 'patch' | 'none',
  priority: 'critical' | 'high' | 'normal' | 'low',
  config: UpdateConfig
): boolean {
  if (updateType === 'none') return false;

  // Critical security packages always auto-update patches and minors
  if (priority === 'critical' && (updateType === 'patch' || updateType === 'minor')) {
    return true;
  }

  // Check config
  if (updateType === 'major') return config.autoUpdate.major;
  if (updateType === 'minor') return config.autoUpdate.minor;
  if (updateType === 'patch') return config.autoUpdate.patch;

  return false;
}

export function getInstalledVersion(packageName: string): string | null {
  if (!isValidNpmName(packageName)) return null;
  try {
    // Attempt 1: let Node resolve from any search path (covers local and global installs)
    try {
      const resolved = require.resolve(`${packageName}/package.json`);
      const pkg = require(resolved);
      if (pkg.version) return pkg.version;
    } catch { /* not on default paths */ }

    // Attempt 2: resolve from cwd (monorepo / workspace installs)
    const cwdPaths = [
      `${packageName}/package.json`,
      `../../node_modules/${packageName}/package.json`,
      `../../../node_modules/${packageName}/package.json`,
    ];
    for (const modulePath of cwdPaths) {
      try {
        const resolved = require.resolve(modulePath, { paths: [process.cwd()] });
        const pkg = require(resolved);
        if (pkg.version) return pkg.version;
      } catch { continue; }
    }

    // Attempt 3: npm global prefix (covers `npm i -g monomind`)
    try {
      const prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8', timeout: 3000 }).trim();
      const globalPkg = require(
        require.resolve(`${packageName}/package.json`, { paths: [`${prefix}/lib/node_modules`] })
      );
      if (globalPkg.version) return globalPkg.version;
    } catch { /* no global install or npm unavailable */ }

    return null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(
  config: UpdateConfig = DEFAULT_CONFIG
): Promise<{ results: UpdateCheckResult[]; skipped: boolean; reason?: string }> {
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

  const results: UpdateCheckResult[] = [];
  const versionCache: Record<string, string> = {};

  // Check each package
  const packagesToCheck = MONOMIND_PACKAGES.filter(
    (pkg) => !config.exclude.includes(pkg)
  );

  // Sort by priority (critical first)
  const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
  packagesToCheck.sort((a, b) => {
    const pa = config.priority[a] || 'normal';
    const pb = config.priority[b] || 'normal';
    return priorityOrder[pa] - priorityOrder[pb];
  });

  await Promise.all(
    packagesToCheck.map(async (packageName) => {
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
    })
  );

  // Record this check
  recordCheck(versionCache);

  // Filter to only updates available
  const updates = results.filter((r) => r.updateType !== 'none');

  return { results: updates, skipped: false };
}

export async function checkSinglePackage(
  packageName: string,
  config: UpdateConfig = DEFAULT_CONFIG
): Promise<UpdateCheckResult | null> {
  if (!isValidNpmName(packageName)) return null;
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
