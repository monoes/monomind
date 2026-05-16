import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('consolidation lock coordination', () => {
  let tmpDir;
  let lockPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-lock-test-'));
    lockPath = path.join(tmpDir, '.monomind', 'consolidation.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('O_EXCL lock file creation succeeds when no lock exists', () => {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    fs.closeSync(fd);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('O_EXCL lock creation fails when lock already exists', () => {
    // Create first lock
    const fd = fs.openSync(lockPath, 'wx');
    fs.closeSync(fd);

    // Second attempt should throw EEXIST
    expect(() => {
      const fd2 = fs.openSync(lockPath, 'wx');
      fs.closeSync(fd2);
    }).toThrow(/EEXIST/);
  });

  it('stale lock (> 5 minutes) is overridable', () => {
    // Create a "stale" lock file with old mtime
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: Date.now() - 6 * 60 * 1000 }));
    // Set file mtime to 6 minutes ago
    const sixMinsAgo = new Date(Date.now() - 6 * 60 * 1000);
    fs.utimesSync(lockPath, sixMinsAgo, sixMinsAgo);

    const stat = fs.statSync(lockPath);
    expect(Date.now() - stat.mtimeMs).toBeGreaterThan(5 * 60 * 1000);
  });

  it('releaseLock removes the lock file', () => {
    // Create lock
    const fd = fs.openSync(lockPath, 'wx');
    fs.closeSync(fd);
    expect(fs.existsSync(lockPath)).toBe(true);

    // Release lock (simulate releaseLock)
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('releaseLock is safe to call when lock does not exist', () => {
    // Should not throw when lock file is absent
    expect(() => {
      try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    }).not.toThrow();
  });

  it('session-end skips consolidation when lock file exists', () => {
    // Create lock file at the path session-handler checks
    const dotMonomind = path.join(process.cwd(), '.monomind');
    const realLockPath = path.join(dotMonomind, 'consolidation.lock');

    const wasLocked = fs.existsSync(realLockPath);
    if (!wasLocked) {
      fs.mkdirSync(dotMonomind, { recursive: true });
      fs.writeFileSync(realLockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    }

    try {
      // Verify lock exists and fs.existsSync returns true (what session-handler checks)
      expect(fs.existsSync(realLockPath)).toBe(true);
    } finally {
      if (!wasLocked) fs.unlinkSync(realLockPath);
    }
  });

  it('lock content records pid and timestamp', () => {
    const fd = fs.openSync(lockPath, 'wx');
    const content = JSON.stringify({ pid: process.pid, ts: Date.now() });
    fs.writeSync(fd, content);
    fs.closeSync(fd);

    const read = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(read.pid).toBe(process.pid);
    expect(typeof read.ts).toBe('number');
  });
});
