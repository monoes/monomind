/**
 * Rate limiter for update checks
 * Prevents excessive npm registry queries
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface RateLimitState {
  lastCheck: string;
  checksToday: number;
  date: string;
  packageVersions: Record<string, string>;
}

const STATE_FILE = path.join(os.homedir(), '.monomind', 'update-state.json');
const DEFAULT_INTERVAL_HOURS = 24;
const MAX_CHECKS_PER_DAY = 10;
// Hard cap on how many package version entries we persist. Prevents an
// attacker who can write to the state file from inflating it unboundedly,
// and protects recordCheck() from DoS via a huge incoming packageVersions map.
const MAX_PACKAGE_VERSIONS = 100;
// Hard cap on the state file size we are willing to read into memory.
const MAX_STATE_FILE_BYTES = 1 * 1024 * 1024; // 1 MB

function ensureDir(): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDefaultState(): RateLimitState {
  return {
    lastCheck: '',
    checksToday: 0,
    date: new Date().toISOString().split('T')[0],
    packageVersions: {},
  };
}

export function loadState(): RateLimitState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      // Guard against oversized state files (DoS / OOM) before reading
      const stat = fs.statSync(STATE_FILE);
      if (stat.size > MAX_STATE_FILE_BYTES) {
        // State file is unreasonably large — discard and start fresh
        try { fs.unlinkSync(STATE_FILE); } catch { /* ignore */ }
        return getDefaultState();
      }
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      // Block prototype pollution via JSON.parse reviver
      const state = JSON.parse(content, (key, value) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
        return value;
      }) as RateLimitState;

      // Validate that packageVersions is a plain object (not an array/primitive)
      if (!state.packageVersions || typeof state.packageVersions !== 'object' || Array.isArray(state.packageVersions)) {
        state.packageVersions = {};
      }
      // Cap the number of package version entries to prevent bloat
      const versionKeys = Object.keys(state.packageVersions);
      if (versionKeys.length > MAX_PACKAGE_VERSIONS) {
        const capped: Record<string, string> = {};
        for (const k of versionKeys.slice(0, MAX_PACKAGE_VERSIONS)) {
          capped[k] = state.packageVersions[k];
        }
        state.packageVersions = capped;
      }

      // Reset counter if new day
      const today = new Date().toISOString().split('T')[0];
      if (state.date !== today) {
        state.date = today;
        state.checksToday = 0;
      }

      return state;
    }
  } catch {
    // Corrupted file, reset
  }
  return getDefaultState();
}

export function saveState(state: RateLimitState): void {
  ensureDir();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

export function shouldCheckForUpdates(
  intervalHours: number = DEFAULT_INTERVAL_HOURS
): { allowed: boolean; reason?: string } {
  // Skip in CI environments
  if (process.env.CI === 'true' || process.env.CONTINUOUS_INTEGRATION === 'true') {
    return { allowed: false, reason: 'CI environment detected' };
  }

  // Skip if explicitly disabled
  if (process.env.MONOMIND_AUTO_UPDATE === 'false') {
    return { allowed: false, reason: 'Auto-update disabled via environment' };
  }

  // Force update if requested
  if (process.env.MONOMIND_FORCE_UPDATE === 'true') {
    return { allowed: true };
  }

  const state = loadState();

  // Check daily limit
  if (state.checksToday >= MAX_CHECKS_PER_DAY) {
    return { allowed: false, reason: `Daily check limit (${MAX_CHECKS_PER_DAY}) reached` };
  }

  // Check time interval
  if (state.lastCheck) {
    const lastCheckTime = new Date(state.lastCheck).getTime();
    const now = Date.now();
    const hoursSinceLastCheck = (now - lastCheckTime) / (1000 * 60 * 60);

    if (hoursSinceLastCheck < intervalHours) {
      const nextCheck = Math.ceil(intervalHours - hoursSinceLastCheck);
      return {
        allowed: false,
        reason: `Last check was ${Math.floor(hoursSinceLastCheck)}h ago (next check in ~${nextCheck}h)`
      };
    }
  }

  return { allowed: true };
}

/**
 * Atomically check the daily limit and pre-increment the counter.
 * Returns false if already at the limit. Callers MUST call recordCheck
 * only after a successful reserveCheck, so that limit enforcement and
 * increment happen in the same synchronous turn (no await gap between
 * them), preventing two concurrent callers both seeing "allowed".
 *
 * IMPORTANT: performs a single loadState() → check → increment → saveState()
 * cycle to eliminate the TOCTOU window that existed when this function
 * delegated to shouldCheckForUpdates() (which called loadState() itself)
 * and then called loadState() a second time to increment. Two callers
 * sharing that gap could both see allowed=true and both increment.
 */
export function reserveCheck(
  intervalHours: number = DEFAULT_INTERVAL_HOURS
): { allowed: boolean; reason?: string } {
  // Fast-path: environment gates that don't need file I/O
  if (process.env.CI === 'true' || process.env.CONTINUOUS_INTEGRATION === 'true') {
    return { allowed: false, reason: 'CI environment detected' };
  }
  if (process.env.MONOMIND_AUTO_UPDATE === 'false') {
    return { allowed: false, reason: 'Auto-update disabled via environment' };
  }

  // Single load — check and increment in one synchronous cycle
  const state = loadState();

  if (process.env.MONOMIND_FORCE_UPDATE !== 'true') {
    // Daily limit
    if (state.checksToday >= MAX_CHECKS_PER_DAY) {
      return { allowed: false, reason: `Daily check limit (${MAX_CHECKS_PER_DAY}) reached` };
    }

    // Time interval
    if (state.lastCheck) {
      const hoursSinceLastCheck = (Date.now() - new Date(state.lastCheck).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastCheck < intervalHours) {
        const nextCheck = Math.ceil(intervalHours - hoursSinceLastCheck);
        return {
          allowed: false,
          reason: `Last check was ${Math.floor(hoursSinceLastCheck)}h ago (next check in ~${nextCheck}h)`,
        };
      }
    }
  }

  // Reserve the slot: increment and persist before any async work begins
  state.checksToday += 1;
  state.lastCheck = new Date().toISOString();
  saveState(state);

  return { allowed: true };
}

export function recordCheck(packageVersions: Record<string, string>): void {
  // Update only package versions; count/timestamp already incremented by reserveCheck
  const state = loadState();
  // Merge only string-valued keys to block prototype pollution and type confusion.
  // Also enforce the total cap so a large incoming map cannot bloat the state file.
  const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
  for (const [k, v] of Object.entries(packageVersions)) {
    if (FORBIDDEN.has(k)) continue;
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    if (Object.keys(state.packageVersions).length >= MAX_PACKAGE_VERSIONS) break;
    state.packageVersions[k] = v;
  }
  saveState(state);
}

export function getCachedVersions(): Record<string, string> {
  return loadState().packageVersions;
}

export function clearCache(): void {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}
