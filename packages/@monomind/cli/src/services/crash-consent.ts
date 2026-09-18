/**
 * Crash-reporting consent — tri-state ('enabled' | 'disabled' | 'unanswered')
 * and the interactive prompt that resolves it.
 *
 * Split out of crash-reporter.ts (i-055-cli revision round 1): this piece
 * has no dependency on the filing pipeline (dedup, lock, gh/token filing)
 * and keeps crash-reporter.ts under the repo's 500-line guideline.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { confirm } from '../prompt.js';

export const STATE_DIR = join(homedir(), '.monomind');
const CONFIG_PATH = join(STATE_DIR, 'crash-reporting.json');

// Bounds the interactive consent prompt so an unattended terminal (or a
// readline that never gets a line) can't hang reportCrash() forever. Kept
// below bin/cli.js's own 30s TTY race timeout, so a slow-but-real answer
// still has room, while a silent one resolves to the safe default (No) with
// a meaningful result instead of the race's generic "timed out" message.
export const PROMPT_TIMEOUT_MS = 15 * 1000;

interface CrashConfig {
  enabled: boolean;
}

export function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

export function readJsonSafe<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonSafe(path: string, data: unknown): void {
  try {
    ensureStateDir();
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // best-effort — a failed write here shouldn't crash the crash reporter
  }
}

export type ConsentState = 'enabled' | 'disabled' | 'unanswered';

/**
 * Tri-state consent, replacing the old boolean default. An absent or
 * malformed config file is 'unanswered' — NOT 'enabled'. Treating "never
 * chosen" as "silently on" was the bug: it let every crash file a public
 * GitHub issue with no consent step of any kind.
 */
export function getConsentState(): ConsentState {
  // Env override, checked FIRST — before the config file — so a measurement
  // harness can switch telemetry off for the duration of a run it intends to
  // make claims about, deterministically, regardless of any persisted
  // answer. `monomind doc eval` sets this: its "zero network calls" verdict
  // must describe the retrieval path, not merely the fact that nothing
  // happened to crash. This org's own harness sets it on every command.
  const env = process.env.MONOMIND_CRASH_REPORTING;
  if (env && ['0', 'off', 'false', 'no'].includes(env.toLowerCase())) return 'disabled';
  const config = readJsonSafe<Partial<CrashConfig>>(CONFIG_PATH, {});
  if (typeof config.enabled !== 'boolean') return 'unanswered';
  return config.enabled ? 'enabled' : 'disabled';
}

export function setEnabled(enabled: boolean): void {
  writeJsonSafe(CONFIG_PATH, { enabled });
}

export function isInteractiveTty(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

/**
 * Shows the local report path, then asks once whether to file it publicly —
 * bounded at PROMPT_TIMEOUT_MS so a readline that never gets an answer can't
 * hang the crash handler forever (bin/cli.js's own uncaughtException/
 * unhandledRejection handlers force-exit right after this regardless, but
 * `monomind report-crash` — the hidden command mono-agent/monotask/mono-clip
 * shell out to — does not, so this bound is load-bearing there). EOF
 * (Ctrl-D) resolves immediately via prompt.ts's own close handling, not
 * through this timeout at all.
 */
export async function promptForConsent(repo: string, reportPath: string): Promise<boolean> {
  const message = `Report this crash publicly to ${repo}? [y/N] (report: ${reportPath})`;
  let timedOut = false;
  const timeout = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      resolve(false);
    }, PROMPT_TIMEOUT_MS);
    timer.unref?.();
  });
  const answer = await Promise.race([confirm({ message, default: false }), timeout]);
  if (timedOut) {
    // The confirm() call above is still awaiting a line from readline —
    // unref the handle so it can't keep the event loop (and thus the
    // process) alive on its own.
    process.stdin.unref?.();
  }
  return answer;
}
