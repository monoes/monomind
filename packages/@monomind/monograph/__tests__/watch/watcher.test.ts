import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MonographWatcher } from '../../src/watch/watcher.js';

const tmpRepo = join(tmpdir(), `monograph-watch-test-${Date.now()}`);

// #255: chokidar tests `ignored` against absolute paths, so a project under a
// dot-directory (or under an ancestor named build/dist/node_modules) had every
// file ignored. Build that layout explicitly instead of relying on TMPDIR.
const dotBase = join(tmpdir(), `monograph-watch-dot-${Date.now()}`);
const dotRepo = join(dotBase, '.dotparent', 'build', 'project');

beforeAll(() => {
  mkdirSync(join(tmpRepo, 'src'), { recursive: true });
  writeFileSync(join(tmpRepo, 'src', 'index.ts'), 'export const x = 1;');

  mkdirSync(join(dotRepo, 'src'), { recursive: true });
  mkdirSync(join(dotRepo, '.hidden'), { recursive: true });
  mkdirSync(join(dotRepo, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(dotRepo, 'src', 'index.ts'), 'export const x = 1;');
  writeFileSync(join(dotRepo, '.hidden', 'a.ts'), 'export const a = 1;');
  writeFileSync(join(dotRepo, 'node_modules', 'pkg', 'index.ts'), 'export const p = 1;');
});

afterAll(() => {
  rmSync(tmpRepo, { recursive: true, force: true });
  rmSync(dotBase, { recursive: true, force: true });
});

describe('MonographWatcher', () => {
  it('emits monograph:updated within 5s after a file change', async () => {
    const updates: string[] = [];
    const watcher = new MonographWatcher(tmpRepo, { debounceMs: 200 });
    watcher.on('monograph:updated', (paths: string[]) => updates.push(...paths));
    await watcher.start();

    // Trigger a file change
    await new Promise(r => setTimeout(r, 300));
    appendFileSync(join(tmpRepo, 'src', 'index.ts'), '\nexport const y = 2;');
    await new Promise(r => setTimeout(r, 2000));

    await watcher.stop();
    expect(updates.length).toBeGreaterThan(0);
  }, 15000);

  it('fires for a project under a dot-directory, still ignoring dot/node_modules paths inside it (#255)', async () => {
    const updates: string[] = [];
    const watcher = new MonographWatcher(dotRepo, { debounceMs: 200 });
    watcher.on('monograph:updated', (paths: string[]) => updates.push(...paths));
    await watcher.start();

    await new Promise(r => setTimeout(r, 300));
    appendFileSync(join(dotRepo, '.hidden', 'a.ts'), '\nexport const b = 2;');
    appendFileSync(join(dotRepo, 'node_modules', 'pkg', 'index.ts'), '\nexport const q = 2;');
    await new Promise(r => setTimeout(r, 1000));
    const updatesFromIgnoredPaths = [...updates];

    appendFileSync(join(dotRepo, 'src', 'index.ts'), '\nexport const y = 2;');
    await new Promise(r => setTimeout(r, 2000));

    await watcher.stop();
    expect(updatesFromIgnoredPaths).toEqual([]);
    expect(updates).toEqual([join(dotRepo, 'src', 'index.ts')]);
  }, 15000);
});
