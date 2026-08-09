/**
 * Cache-eviction worker — symlink escape.
 *
 * safePath() (lexical-only: path.resolve + startsWith) can't tell a
 * ".monomind/cache" that's a real directory from one that's a symlink
 * pointing somewhere else entirely. If it's a symlink, `fs.readdir` follows
 * it transparently, and the recursive `fs.rm` calls below then delete files
 * OUTSIDE projectRoot — worse than the read-only symlink escapes already
 * fixed elsewhere in this codebase, because this one deletes. safePathAsync
 * closes it by realpath-ing both sides before comparing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { symlinkSync } from 'fs';
import * as os from 'os';
import { createCacheWorker } from '../src/index.js';

let projectRoot: string;
let outsideDir: string;

describe('cache worker — symlinked cache directory', () => {
  beforeEach(async () => {
    const base = path.join(os.tmpdir(), 'monomind-cache-worker-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    projectRoot = path.join(base, 'project');
    outsideDir = path.join(base, 'outside-secret');
    await fs.mkdir(path.join(projectRoot, '.monomind'), { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    // A file old enough to trigger the worker's 7-day eviction threshold.
    const secretFile = path.join(outsideDir, 'do-not-delete.txt');
    await fs.writeFile(secretFile, 'protected content outside projectRoot');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await fs.utimes(secretFile, eightDaysAgo, eightDaysAgo);

    // .monomind/cache is a SYMLINK to a directory outside projectRoot, rather
    // than a plain subdirectory — the exploit is in the cache dir itself, not
    // in an entry inside it (entries that are symlinks are already skipped by
    // this worker's own `entry.isSymbolicLink()` check a few lines down).
    symlinkSync(outsideDir, path.join(projectRoot, '.monomind', 'cache'));
  });

  afterEach(async () => {
    await fs.rm(path.dirname(projectRoot), { recursive: true, force: true });
  });

  it('does not delete files outside projectRoot when .monomind/cache is a symlink', async () => {
    const worker = createCacheWorker(projectRoot);
    await worker();

    const survived = await fs.readFile(path.join(outsideDir, 'do-not-delete.txt'), 'utf-8').catch(() => null);
    expect(survived).toBe('protected content outside projectRoot');
  });
});
