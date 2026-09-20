/**
 * o-38: `retireGeneratedEntry`'s EXDEV fallback (rename fails because the
 * retire destination is on a different filesystem than the source — cross-
 * device renames are not atomic and Node surfaces this as EXDEV). The
 * fallback must copy-then-remove and still report success.
 *
 * Isolated in its own file because it needs `node:fs`'s `renameSync` mocked
 * at the module level (`vi.spyOn` cannot override an ESM `import * as fs`
 * namespace's own exports), and that mock must not leak into
 * `init-retires-not-deletes.test.ts`'s real, unmocked filesystem tests.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retireGeneratedEntry } from '../init/shared.js';
import type { InitResult } from '../init/types.js';
import { detectPlatform } from '../init/types.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (..._args: Parameters<typeof actual.renameSync>) => {
      const err = new Error('simulated EXDEV') as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      throw err;
    },
  };
});

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

/** Every regular file under `dir`, relative to `dir`. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

describe('retireGeneratedEntry falls back to copy+remove on EXDEV (o-38)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-retire-exdev-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies the entry to the retire destination and removes the original, reporting success', () => {
    const staleDir = path.join(tmpDir, 'stale-skill-exdev');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'SKILL.md'), 'exdev content\n');
    fs.mkdirSync(path.join(staleDir, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'notes', 'personal.md'), 'user note\n');

    const result = freshResult();
    retireGeneratedEntry(tmpDir, 'skills/stale-skill-exdev', staleDir, result);

    expect(fs.existsSync(staleDir)).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.removed.length).toBe(1);

    const retiredFiles = listFiles(tmpDir).filter((f) => f.includes('stale-skill-exdev'));
    expect(retiredFiles.some((f) => f.endsWith('SKILL.md'))).toBe(true);
    expect(retiredFiles.some((f) => f.endsWith(path.join('notes', 'personal.md')))).toBe(true);
    const absNotes = path.join(tmpDir, retiredFiles.find((f) => f.endsWith('personal.md'))!);
    expect(fs.readFileSync(absNotes, 'utf8')).toBe('user note\n');
  });
});
