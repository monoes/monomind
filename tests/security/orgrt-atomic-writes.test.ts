/**
 * C4 — Non-atomic state writes can brick org state on crash
 *
 * Before fix: daemon.ts persisted runtime.json, approvals.json, and
 * branch bus.jsonl via direct writeFileSync(<final-path>, ...). A
 * SIGINT/SIGTERM/crash mid-write left a truncated or 0-byte file that
 * every subsequent `org status`, `isOrgRunning`, scheduler, or
 * `mark-complete` call then failed to parse.
 *
 * After fix: those writes use writeJsonFileAtomic() (tmp + rename) from
 * utils/json-file.ts, which is already used in 6+ other places in the
 * codebase. A crash mid-write leaves the previous version intact.
 *
 * Verification: read the daemon.ts source and assert no direct
 * writeFileSync to the runtime/approvals state files. Source-level
 * assertion is the right tool here — simulating a real mid-write crash
 * from JS is unreliable (would need a child process and SIGKILL timing).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DAEMON_SRC = readFileSync(
  new URL('../../packages/@monomind/cli/src/orgrt/daemon.ts', import.meta.url),
  'utf-8',
);

describe('C4 — atomic state writes in orgrt/daemon.ts', () => {
  // Match `writeFileSync(<final-path>, ...)` where <final-path> is NOT a
  // `.tmp` suffix. Pre-fix, all of these were direct overwrites of state
  // files. Post-fix, they go through writeJsonFileAtomic() (which writes
  // to `${path}.${pid}.${ts}.tmp` then renames).
  const _directWriteCalls = [
    ...DAEMON_SRC.matchAll(/writeFileSync\(\s*(p|approvalsPath|[a-zA-Z_]+Path|join\([^)]+\))/g),
  ];

  it('source file is loaded', () => {
    expect(DAEMON_SRC.length).toBeGreaterThan(50_000);
  });

  it('no direct writeFileSync to runtime.json (uses writeJsonFileAtomic)', () => {
    // Find the persistState / persistCrashStateAll functions and verify
    // the writeFileSync calls they contain target tmp paths only.
    const runtimeWriteMatches = DAEMON_SRC.match(/writeFileSync\(p,\s*JSON\.stringify/g) ?? [];
    // Pre-fix: 3 such calls (persistState, persistCrashStateAll, writeHeartbeat).
    // Post-fix: 0 — writeJsonFileAtomic(p, ...) replaces each.
    expect(runtimeWriteMatches.length).toBe(0);
  });

  it('no direct writeFileSync to approvals.json', () => {
    const approvalsWriteMatches = DAEMON_SRC.match(/writeFileSync\(approvalsPath,/g) ?? [];
    expect(approvalsWriteMatches.length).toBe(0);
  });

  it('no direct writeFileSync to branch bus.jsonl', () => {
    const branchWriteMatches =
      DAEMON_SRC.match(/writeFileSync\(join\(branchDir,\s*'bus\.jsonl'\)/g) ?? [];
    expect(branchWriteMatches.length).toBe(0);
  });

  it('imports writeJsonFileAtomic from utils/json-file', () => {
    expect(DAEMON_SRC).toMatch(/from '\.\.\/utils\/json-file\.js'/);
    expect(DAEMON_SRC).toMatch(/writeJsonFileAtomic/);
  });
});
