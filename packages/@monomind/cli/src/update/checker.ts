/**
 * Update checker for @monomind packages
 * Queries npm registry and compares versions
 */

import { createRequire } from 'module';
import { execFileSync } from 'child_process';
// Inline semver shim — avoids external dependency
const semver = {
  valid: (v: string | null | undefined): string | null => /^\d+\.\d+\.\d+/.test(v || '') ? v! : null,
  eq: (a: string, b: string): boolean => a === b,
  major: (v: string): number => parseInt((v || '0').split('.')[0], 10),
  minor: (v: string): number => parseInt((v || '0').split('.')[1] || '0', 10),
  patch: (v: string): number => parseInt(((v || '0').split('.')[2] || '0').replace(/[^0-9].*/, ''), 10),
  gt: (a: string, b: string): boolean => {
    const [aMaj, aMin, aPat] = (a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const [bMaj, bMin, bPat] = (b || '0').split('.').map(n => parseInt(n, 10) || 0);
    return aMaj !== bMaj ? aMaj > bMaj : aMin !== bMin ? aMin > bMin : aPat > bPat;
  },
};
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
    minor: false,
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

// Cap registry response at 5 MB. The full npm registry payload for a package
// can include the entire `versions` object (dozens of version entries with
// dist/scripts/dependencies for each). A spoofed or compromised registry
// endpoint could stream an arbitrarily large body; AbortSignal.timeout(5000)
// only enforces a wall-clock deadline and does NOT cap bytes. Without this
// cap, fetchPackageInfo will buffer an unbounded body into memory (OOM).
const MAX_REGISTRY_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

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

    // Reject immediately if Content-Length header exceeds cap
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const declared = parseInt(contentLength, 10);
      if (Number.isFinite(declared) && declared > MAX_REGISTRY_RESPONSE_BYTES) {
        return null;
      }
    }

    // Stream body and enforce byte cap — prevents OOM if the server streams
    // a large body that evades the Content-Length check (missing/wrong header).
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_REGISTRY_RESPONSE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    }
    const buf = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder('utf-8').decode(buf);
    return JSON.parse(text) as NpmPackageInfo;
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

  // Not an upgrade (equal or downgrade)
  if (!semver.gt(latest, current)) {
    return 'none';
  }

  if (semver.major(latest) > semver.major(current)) {
    return 'major';
  }

  if (semver.minor(latest) > semver.minor(current)) {
    return 'minor';
  }

  return 'patch';
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
