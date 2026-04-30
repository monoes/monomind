import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MonographWatcher } from '../../src/watch/watcher.js';

const tmpRepo = join(tmpdir(), `monograph-watch-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(join(tmpRepo, 'src'), { recursive: true });
  writeFileSync(join(tmpRepo, 'src', 'index.ts'), 'export const x = 1;');
});

afterAll(() => rmSync(tmpRepo, { recursive: true, force: true }));

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
});
