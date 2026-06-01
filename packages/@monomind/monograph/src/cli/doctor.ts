/**
 * runDoctor — Platform health checks for the Monograph knowledge graph.
 *
 * Checks:
 * 1. Node.js version (must be >= 18)
 * 2. SQLite DB file exists at .monomind/monograph.db
 * 3. SQLite DB is readable (SELECT 1)
 * 4. DB node count (warns if graph not built)
 * 5. Disk space (warns if < 100 MB free)
 * 6. Tree-sitter availability
 */

import { existsSync, statfsSync } from 'fs';
import { join } from 'path';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  /** true if no 'error' level checks */
  healthy: boolean;
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkNodeVersion(): DoctorCheck {
  const raw = process.version; // e.g. 'v20.1.0'
  const major = parseInt(raw.replace(/^v/, '').split('.')[0], 10);
  if (major >= 18) {
    return { name: 'Node version', status: 'ok', message: `${raw} (>= 18 required)` };
  }
  return {
    name: 'Node version',
    status: 'error',
    message: `${raw} — Node >= 18 is required`,
  };
}

function checkDbExists(dbPath: string): DoctorCheck {
  if (existsSync(dbPath)) {
    return { name: 'SQLite DB exists', status: 'ok', message: dbPath };
  }
  return {
    name: 'SQLite DB exists',
    status: 'error',
    message: `DB not found at ${dbPath} — run monograph build first`,
  };
}

function checkDbReadable(dbPath: string): DoctorCheck {
  try {
    // Dynamic require keeps this check lazy so missing better-sqlite3 doesn't
    // crash the entire doctor invocation.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    db.prepare('SELECT 1').get();
    db.close();
    return { name: 'SQLite DB readable', status: 'ok', message: 'SELECT 1 passed' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'SQLite DB readable', status: 'error', message: msg };
  }
}

function checkNodeCount(dbPath: string): DoctorCheck {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT COUNT(*) AS n FROM nodes').get() as { n: number } | undefined;
    db.close();
    const count = row?.n ?? 0;
    if (count === 0) {
      return {
        name: 'DB node count',
        status: 'warn',
        message: '0 nodes — graph not built yet. Run monograph build.',
      };
    }
    return { name: 'DB node count', status: 'ok', message: `${count} nodes indexed` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'DB node count', status: 'warn', message: `Could not read node count: ${msg}` };
  }
}

function checkDiskSpace(repoPath: string): DoctorCheck {
  const MIN_FREE_BYTES = 100 * 1024 * 1024; // 100 MB
  try {
    if (typeof statfsSync !== 'function') {
      return {
        name: 'Disk space',
        status: 'ok',
        message: 'statfsSync not available on this platform — skipped',
      };
    }
    const stats = statfsSync(repoPath);
    const freeBytes = stats.bsize * stats.bavail;
    const freeMB = Math.round(freeBytes / (1024 * 1024));
    if (freeBytes < MIN_FREE_BYTES) {
      return {
        name: 'Disk space',
        status: 'warn',
        message: `Only ${freeMB} MB free — less than 100 MB recommended`,
      };
    }
    return { name: 'Disk space', status: 'ok', message: `${freeMB} MB free` };
  } catch {
    // statfsSync may throw on some platforms (e.g. Windows)
    return {
      name: 'Disk space',
      status: 'ok',
      message: 'Disk space check not supported on this platform — skipped',
    };
  }
}

async function checkTreeSitter(): Promise<DoctorCheck> {
  try {
    await import('tree-sitter');
    return { name: 'Tree-sitter', status: 'ok', message: 'tree-sitter module available' };
  } catch {
    return {
      name: 'Tree-sitter',
      status: 'warn',
      message: 'tree-sitter not available — install it to enable code parsing',
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run all platform health checks and return a structured result.
 *
 * @param repoPath - Absolute path to the repository root
 * @returns DoctorResult with individual check outcomes and overall health
 *
 * @example
 * const result = await runDoctor('/path/to/repo');
 * if (!result.healthy) console.error('Some checks failed.');
 */
export async function runDoctor(repoPath: string): Promise<DoctorResult> {
  const dbPath = join(repoPath, '.monomind', 'monograph.db');

  const checks: DoctorCheck[] = [];

  // 1. Node version
  checks.push(checkNodeVersion());

  // 2. DB file existence
  const dbExistsCheck = checkDbExists(dbPath);
  checks.push(dbExistsCheck);

  // 3. DB readable (only if DB exists)
  if (dbExistsCheck.status !== 'error') {
    checks.push(checkDbReadable(dbPath));
    checks.push(checkNodeCount(dbPath));
  } else {
    checks.push({
      name: 'SQLite DB readable',
      status: 'error',
      message: 'Skipped — DB file not found',
    });
    checks.push({
      name: 'DB node count',
      status: 'error',
      message: 'Skipped — DB file not found',
    });
  }

  // 4. Disk space
  checks.push(checkDiskSpace(repoPath));

  // 5. Tree-sitter
  checks.push(await checkTreeSitter());

  const healthy = checks.every((c) => c.status !== 'error');

  return { checks, healthy };
}
