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
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      const state = JSON.parse(content) as RateLimitState;

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
 */
export function reserveCheck(
  intervalHours: number = DEFAULT_INTERVAL_HOURS
): { allowed: boolean; reason?: string } {
  const decision = shouldCheckForUpdates(intervalHours);
  if (!decision.allowed) return decision;

  // Increment immediately, before any async work, so concurrent callers
  // see an updated count on their next tick.
  const state = loadState();
  state.checksToday += 1;
  state.lastCheck = new Date().toISOString();
  saveState(state);

  return { allowed: true };
}

export function recordCheck(packageVersions: Record<string, string>): void {
  // Update only package versions; count/timestamp already incremented by reserveCheck
  const state = loadState();
  state.packageVersions = { ...state.packageVersions, ...packageVersions };
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
