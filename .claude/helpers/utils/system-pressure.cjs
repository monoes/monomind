'use strict';
const os = require('os');

const PRESSURE_THRESHOLD = 0.10; // 10% free = critical

/**
 * Returns { free, total, freeRatio, level } for logging.
 * On macOS, `memory_pressure`'s bare invocation has no query mode — it
 * always exits 0 regardless of actual pressure (see `man memory_pressure`:
 * exit-code levels only apply to its -l/-S simulate-pressure flags, not to
 * reading real system state). What IS real there is its printed
 * "System-wide memory free percentage: NN%" line, which accounts for
 * inactive/purgeable/compressed pages that os.freemem() ignores — so that
 * line, not the exit code, is the authoritative signal on macOS.
 */
function getMemoryInfo() {
  const free = os.freemem();
  const total = os.totalmem();
  let freeRatio = total > 0 ? free / total : 1;

  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process');
      const out = execSync('memory_pressure', { timeout: 2000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const match = out.match(/free percentage:\s*(\d+)%/);
      if (match) freeRatio = parseInt(match[1], 10) / 100;
    } catch { /* use os.freemem() fallback */ }
  }

  const usedMB = Math.round(total * (1 - freeRatio) / 1024 / 1024);
  const totalMB = Math.round(total / 1024 / 1024);
  const level = freeRatio < 0.05 ? 'urgent' : freeRatio < 0.10 ? 'critical' : freeRatio < 0.20 ? 'warn' : 'normal';
  return { free, total, freeRatio, usedMB, totalMB, level };
}

/**
 * Returns true when the system is under critical memory pressure.
 * Derived from getMemoryInfo()'s freeRatio (real free% on macOS via
 * memory_pressure's output, os.freemem() elsewhere) — not from any command
 * exit code, since memory_pressure's bare invocation always exits 0.
 */
function isMemoryPressureCritical() {
  return getMemoryInfo().freeRatio < PRESSURE_THRESHOLD;
}

module.exports = { isMemoryPressureCritical, getMemoryInfo };
