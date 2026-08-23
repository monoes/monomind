/**
 * Consolidation lock coordination — drives the REAL implementations:
 * - lock acquire/release/stale-override via claimLock/releaseLock from
 *   .claude/helpers/utils/fs-helpers.cjs (the primitive the daemon-side
 *   code uses for .monomind locks)
 * - the session-end skip via .claude/helpers/handlers/session-handler.cjs,
 *   which checks .monomind/consolidation.lock under hCtx.CWD
 *
 * Everything runs against a per-test tmpDir — never the repo's own
 * .monomind directory (the previous version of this file re-implemented
 * the logic inline and wrote a lock into process.cwd(), leaving stale
 * locks that made real session-ends skip consolidation).
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const HELPERS = path.resolve(__dirname, '../../.claude/helpers');
const { claimLock, releaseLock } = require(path.join(HELPERS, 'utils/fs-helpers.cjs'));
const SH_PATH = path.join(HELPERS, 'handlers/session-handler.cjs');

function loadSessionHandler() {
  delete require.cache[SH_PATH];
  return require(SH_PATH);
}

let tmpDir;
let lockPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-lock-test-'));
  lockPath = path.join(tmpDir, '.monomind', 'consolidation.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('claimLock (real fs-helpers implementation)', () => {
  it('acquires the lock when none exists and records the pid', () => {
    expect(claimLock(lockPath)).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(Number(fs.readFileSync(lockPath, 'utf-8'))).toBe(process.pid);
  });

  it('fails to acquire while a fresh lock is held', () => {
    expect(claimLock(lockPath)).toBe(true);
    // A second claim by this process (same pid, fresh mtime) must fail —
    // the lock is held, not stale.
    expect(claimLock(lockPath)).toBe(false);
  });

  it('overrides a stale lock (mtime older than staleMs)', () => {
    // Simulate a lock left behind by a killed run
    fs.writeFileSync(lockPath, '99999', 'utf-8');
    const sixMinsAgo = new Date(Date.now() - 6 * 60 * 1000);
    fs.utimesSync(lockPath, sixMinsAgo, sixMinsAgo);

    expect(claimLock(lockPath, 5 * 60 * 1000)).toBe(true);
    // The stale break is atomic (rename-to-claim), and the new lock is ours
    expect(Number(fs.readFileSync(lockPath, 'utf-8'))).toBe(process.pid);
    // mtime is fresh again
    expect(Date.now() - fs.statSync(lockPath).mtimeMs).toBeLessThan(5 * 60 * 1000);
  });

  it('does not override a lock that is old but within staleMs', () => {
    fs.writeFileSync(lockPath, '99999', 'utf-8');
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    fs.utimesSync(lockPath, oneMinAgo, oneMinAgo);
    expect(claimLock(lockPath, 5 * 60 * 1000)).toBe(false);
  });
});

describe('releaseLock (real fs-helpers implementation)', () => {
  it('removes a lock owned by this process', () => {
    expect(claimLock(lockPath)).toBe(true);
    releaseLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('does not remove a lock owned by another pid', () => {
    fs.writeFileSync(lockPath, '99999', 'utf-8');
    releaseLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('is safe to call when no lock exists', () => {
    expect(() => releaseLock(lockPath)).not.toThrow();
  });

  it('released lock can be re-acquired', () => {
    expect(claimLock(lockPath)).toBe(true);
    releaseLock(lockPath);
    expect(claimLock(lockPath)).toBe(true);
  });
});

describe('session-handler coordination with the lock', () => {
  function makeHCtx(intelligence) {
    return {
      hookInput: {},
      CWD: tmpDir,
      session: null,
      intelligence,
      getLearningService: async () => null,
      runWithTimeout: async (fn) => fn(),
      _hooksModule: null,
    };
  }

  it('session-end skips consolidation while the lock is held', async () => {
    const sh = loadSessionHandler();
    expect(claimLock(lockPath)).toBe(true); // daemon holds it
    const consolidate = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await sh.handleEnd(makeHCtx({ consolidate }));
      expect(consolidate).not.toHaveBeenCalled();
      const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('daemon holds lock');
    } finally {
      releaseLock(lockPath);
    }
  });

  it('session-end consolidates again once the lock is released', async () => {
    const sh = loadSessionHandler();
    expect(claimLock(lockPath)).toBe(true);
    releaseLock(lockPath);
    const consolidate = vi.fn().mockResolvedValue({ entries: 0, edges: 0, newEntries: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(makeHCtx({ consolidate }));
    expect(consolidate).toHaveBeenCalled();
  });

  it('never touches the repository lock — all paths stay inside tmpDir', () => {
    // Guard against regression to the old fake test, which wrote a lock into
    // path.join(process.cwd(), '.monomind', 'consolidation.lock').
    expect(lockPath.startsWith(tmpDir)).toBe(true);
    expect(path.resolve(tmpDir)).not.toBe(path.resolve(process.cwd()));
  });
});
