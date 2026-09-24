/**
 * P2-14: Quiet the fresh-install doctor. On a brand-new install, 9+ checks
 * report warnings that are actually expected states. Detect fresh install
 * (`.monomind/` dir < 5 min old) and downgrade expected warnings to info
 * (the caller skips this under --verbose).
 */

import { statSync } from 'node:fs';
import * as path from 'node:path';
import type { DoctorResult } from './doctor-json.js';

const FRESH_EXPECTED = new Set([
  'Memory Database',
  'Memory Knowledge Graph',
  'Second Brain Model',
  'Graph freshness',
  'MCP Servers',
  'Worker Metrics',
  'Security Audit',
  'Helper Files',
  'AppleDouble Sidecars',
  'Monoes Memory',
]);

export function downgradeFreshInstallWarnings(settled: DoctorResult[], cwd: string): void {
  const monomindDir = path.join(cwd, '.monomind');
  let isFreshInstall = false;
  try {
    const stat = statSync(monomindDir);
    isFreshInstall = Date.now() - stat.birthtimeMs < 5 * 60 * 1000; // < 5 min old
  } catch {
    /* dir doesn't exist — not our project */
  }
  if (!isFreshInstall) return;
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === 'warn' && FRESH_EXPECTED.has(settled[i].name)) {
      settled[i] = {
        ...settled[i],
        status: 'info' as const,
        message: `${settled[i].message} (expected on fresh install — run with --verbose for details)`,
      };
    }
  }
}
