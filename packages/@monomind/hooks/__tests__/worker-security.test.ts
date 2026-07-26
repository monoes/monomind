/**
 * Security worker — honest-reporting tests.
 *
 * Regression guard: an unreadable file used to abort the entire scan (one
 * try/catch wrapped the whole collect+read loop) and the worker then reported
 * `status: 'clean'` with zero findings — i.e. "we found nothing" when the
 * truth was "we did not look".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { TestContext } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

import { createSecurityWorker, WorkerManager } from '../src/index.js';
import {
  scanDirectoryForPatterns,
  collectFiles,
  searchDDDPatterns,
} from '../src/workers/worker-utils.js';
import { toSecurityStatus } from '../src/workers/worker-manager.js';

let ROOT: string;
let SRC: string;

const NO_PERMS =
  'chmod 000 did not deny access here — running as root, or on a filesystem ' +
  'without POSIX permissions (exFAT/FAT). The premise of this test cannot hold, ' +
  'so it is SKIPPED rather than passing vacuously.';

/**
 * Skip loudly (not silently) when the sandbox cannot actually deny reads.
 *
 * These tests used to `return` early in that situation, which reported a
 * green tick for a test that never exercised anything — the exact
 * "looked clean because we did not look" failure they exist to prevent.
 */
async function requireFileUnreadable(ctx: TestContext, p: string): Promise<void> {
  const denied = await fs.readFile(p, 'utf-8').then(() => false, () => true);
  if (!denied) ctx.skip(`${NO_PERMS} (file: ${p})`);
}

async function requireDirUnreadable(ctx: TestContext, p: string): Promise<void> {
  const denied = await fs.readdir(p).then(() => false, () => true);
  if (!denied) ctx.skip(`${NO_PERMS} (directory: ${p})`);
}

// The scan reads .ts files in readdir order; naming the locked file so it
// sorts first is what made the original bug swallow every later finding.
const LOCKED = 'aaa-locked.ts';
const SECRETFILE = 'zzz-secret.ts';

async function chmodQuiet(p: string, mode: number): Promise<void> {
  await fs.chmod(p, mode).catch(() => {});
}

describe('security worker — unreadable files', () => {
  beforeEach(async () => {
    ROOT = path.join(os.tmpdir(), 'monomind-sec-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    SRC = path.join(ROOT, 'src');
    await fs.mkdir(SRC, { recursive: true });
    await fs.writeFile(path.join(SRC, LOCKED), 'const harmless = 1;\n');
    await fs.writeFile(path.join(SRC, SECRETFILE), 'const password = "hunter2";\n');
  });

  afterEach(async () => {
    await chmodQuiet(path.join(SRC, LOCKED), 0o644);
    await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {});
  });

  it('reports findings and a clean, complete scan when everything is readable', async () => {
    const result = await createSecurityWorker(ROOT)();
    const data = result.data as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(data.secrets).toBe(1);
    expect(data.status).toBe('warning');
    expect(data.incomplete).toBe(false);
    expect(data.skippedCount).toBe(0);
    expect(data.filesScanned).toBe(2);
  });

  it('still finds the secret in later files when an earlier file is unreadable', async (ctx) => {
    await fs.chmod(path.join(SRC, LOCKED), 0o000);
    await requireFileUnreadable(ctx, path.join(SRC, LOCKED));

    const result = await createSecurityWorker(ROOT)();
    const data = result.data as Record<string, unknown>;

    // The whole point: the unreadable file must not swallow the finding.
    expect(data.secrets).toBe(1);
    expect(data.filesScanned).toBe(1);
  });

  it('never reports "clean" when a path could not be read', async (ctx) => {
    // Remove the secret so the only reason for a non-clean verdict is the
    // unreadable file itself.
    await fs.rm(path.join(SRC, SECRETFILE));
    await fs.chmod(path.join(SRC, LOCKED), 0o000);
    await requireFileUnreadable(ctx, path.join(SRC, LOCKED));

    const result = await createSecurityWorker(ROOT)();
    const data = result.data as Record<string, unknown>;

    expect(data.totalIssues).toBe(0);
    expect(data.status).not.toBe('clean');
    expect(data.status).toBe('incomplete');
    expect(data.incomplete).toBe(true);
    expect(data.skippedCount).toBe(1);
  });

  it('persists the incomplete verdict and skipped paths to scan-results.json', async (ctx) => {
    await fs.chmod(path.join(SRC, LOCKED), 0o000);
    await requireFileUnreadable(ctx, path.join(SRC, LOCKED));

    await createSecurityWorker(ROOT)();

    const raw = await fs.readFile(
      path.join(ROOT, '.monomind', 'security', 'scan-results.json'),
      'utf-8'
    );
    const onDisk = JSON.parse(raw) as Record<string, unknown>;

    expect(onDisk.incomplete).toBe(true);
    expect(onDisk.skippedCount).toBe(1);
    expect((onDisk.skippedPaths as string[])[0]).toContain(LOCKED);
    expect(onDisk.status).not.toBe('clean');
  });

  it('does not report fabricated CVE or insecurePattern numbers', async () => {
    const result = await createSecurityWorker(ROOT)();
    const data = result.data as Record<string, unknown>;

    expect(data).not.toHaveProperty('cvesRemediated');

    const onDisk = JSON.parse(
      await fs.readFile(path.join(ROOT, '.monomind', 'security', 'scan-results.json'), 'utf-8')
    ) as Record<string, unknown>;

    expect(onDisk).not.toHaveProperty('cves');
    expect(onDisk.findings as Record<string, number>).not.toHaveProperty('insecurePatterns');
  });
});

describe('scanDirectoryForPatterns', () => {
  it('reports unreadable files in `skipped` instead of aborting', async (ctx) => {
    const root = path.join(os.tmpdir(), 'monomind-scan-' + Date.now());
    await fs.mkdir(root, { recursive: true });
    const locked = path.join(root, 'a.ts');
    await fs.writeFile(locked, 'const x = 1;\n');
    await fs.writeFile(path.join(root, 'b.ts'), 'const api_key = "abc";\n');
    await fs.chmod(locked, 0o000);

    try {
      await requireFileUnreadable(ctx, locked);

      const res = await scanDirectoryForPatterns(root, [/api[_-]?key\s*[=:]\s*["'][^"']+["']/gi], []);
      expect(res.secrets).toBe(1);
      expect(res.filesScanned).toBe(1);
      expect(res.skipped).toHaveLength(1);
      expect(res.skipped[0]).toContain('a.ts');
    } finally {
      await fs.chmod(locked, 0o644).catch(() => {});
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns an empty, non-skipped result for a directory that does not exist', async () => {
    const res = await scanDirectoryForPatterns(
      path.join(os.tmpdir(), 'monomind-nope-' + Date.now()),
      [/password/gi],
      []
    );
    expect(res).toEqual({ secrets: 0, vulnerabilities: 0, filesScanned: 0, skipped: [] });
  });
});

// ============================================================================
// Unreadable DIRECTORIES — same bug class as unreadable files
// ============================================================================

/**
 * `collectFiles` used to swallow every readdir error and return []. An
 * unreadable subdirectory therefore produced zero files, zero skips, and a
 * "clean" security verdict over code that was never opened. Directory-level
 * failures must surface exactly like file-level ones.
 */
describe('collectFiles — unreadable directories', () => {
  let root: string;
  let locked: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), 'monomind-cf-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    locked = path.join(root, 'locked');
    await fs.mkdir(locked, { recursive: true });
    await fs.writeFile(path.join(root, 'visible.ts'), 'const ok = 1;\n');
    await fs.writeFile(path.join(locked, 'hidden.ts'), 'const password = "hunter2";\n');
  });

  afterEach(async () => {
    await chmodQuiet(locked, 0o755);
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('reports an unreadable directory in `skipped`', async (ctx) => {
    await fs.chmod(locked, 0o000);
    await requireDirUnreadable(ctx, locked);

    const res = await collectFiles(root, '.ts');

    // The readable sibling is still collected...
    expect(res.files.map(f => path.basename(f))).toEqual(['visible.ts']);
    // ...and the unopened directory is named, not silently dropped.
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]).toBe(locked);
  });

  it('does not mark a directory that simply does not exist as skipped', async () => {
    const res = await collectFiles(path.join(os.tmpdir(), 'monomind-cf-nope-' + Date.now()), '.ts');
    expect(res).toEqual({ files: [], skipped: [] });
  });

  it('propagates nested skips up through the recursion', async (ctx) => {
    const nested = path.join(root, 'a', 'b');
    await fs.mkdir(nested, { recursive: true });
    await fs.chmod(nested, 0o000);
    await requireDirUnreadable(ctx, nested);

    try {
      const res = await collectFiles(root, '.ts');
      expect(res.skipped).toContain(nested);
    } finally {
      await chmodQuiet(nested, 0o755);
    }
  });
});

describe('security worker — unreadable directories', () => {
  let root: string;
  let locked: string;

  beforeEach(async () => {
    root = path.join(os.tmpdir(), 'monomind-secdir-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    locked = path.join(root, 'src', 'locked');
    await fs.mkdir(locked, { recursive: true });
    await fs.writeFile(path.join(locked, 'hidden.ts'), 'const password = "hunter2";\n');
  });

  afterEach(async () => {
    await chmodQuiet(locked, 0o755);
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('never reports "clean" when a directory could not be enumerated', async (ctx) => {
    await fs.chmod(locked, 0o000);
    await requireDirUnreadable(ctx, locked);

    const data = (await createSecurityWorker(root)()).data as Record<string, unknown>;

    expect(data.filesScanned).toBe(0);
    expect(data.status).not.toBe('clean');
    expect(data.status).toBe('incomplete');
    expect(data.incomplete).toBe(true);
    expect(data.skippedCount).toBe(1);
  });

  it('counts a doubly-walked unreadable directory once', async (ctx) => {
    // scanDirectoryForPatterns walks the tree twice (.ts then .js); the
    // skipped directory must not be double-counted.
    await fs.chmod(locked, 0o000);
    await requireDirUnreadable(ctx, locked);

    const data = (await createSecurityWorker(root)()).data as Record<string, unknown>;
    expect(data.skippedCount).toBe(1);
  });
});

describe('searchDDDPatterns — unreadable directories', () => {
  it('returns counts alongside the paths it could not read', async (ctx) => {
    const root = path.join(os.tmpdir(), 'monomind-ddd-' + Date.now());
    const locked = path.join(root, 'locked');
    await fs.mkdir(locked, { recursive: true });
    await fs.writeFile(path.join(root, 'ok.ts'), 'class UserRepository {}\n');
    await fs.chmod(locked, 0o000);

    try {
      await requireDirUnreadable(ctx, locked);

      const res = await searchDDDPatterns(root);
      expect(res.patterns.repositories).toBe(1);
      expect(res.skipped).toEqual([locked]);
    } finally {
      await chmodQuiet(locked, 0o755);
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ============================================================================
// Statusline rendering of the 'incomplete' verdict
// ============================================================================

describe('statusline security status', () => {
  function managerWithSecurityStatus(status: unknown): WorkerManager {
    const manager = new WorkerManager(os.tmpdir());
    // The worker metrics map is the manager's own state; seeding it directly
    // is the only way to render a specific verdict without a real scan.
    (manager as unknown as { metrics: Map<string, unknown> }).metrics.set('security', {
      status: 'idle',
      lastResult: { status, totalIssues: 0 },
    });
    return manager;
  }

  it('does not render an incomplete scan with the all-clear shield', () => {
    const manager = managerWithSecurityStatus('incomplete');

    expect(manager.getStatuslineData().security.status).toBe('incomplete');
    expect(manager.getStatuslineString()).not.toContain('🛡️');
    expect(manager.getStatuslineString()).toContain('❔');
  });

  it('still renders clean/warning/critical as before', () => {
    expect(managerWithSecurityStatus('clean').getStatuslineString()).toContain('🛡️');
    expect(managerWithSecurityStatus('warning').getStatuslineString()).toContain('⚠️');
    expect(managerWithSecurityStatus('critical').getStatuslineString()).toContain('🚨');
  });

  it('treats an unrecognised verdict as incomplete, not clean', () => {
    expect(toSecurityStatus('banana')).toBe('incomplete');
    expect(toSecurityStatus(42)).toBe('incomplete');
    expect(managerWithSecurityStatus('banana').getStatuslineData().security.status).toBe('incomplete');
  });

  it('keeps the clean default when the security worker has no result', () => {
    expect(toSecurityStatus(undefined)).toBe('clean');
    expect(new WorkerManager(os.tmpdir()).getStatuslineData().security.status).toBe('clean');
  });
});
