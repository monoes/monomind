import { describe, it, expect, afterEach } from 'vitest';
import { FileWatcher } from '../../src/capabilities/watcher.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

/** Poll until the events array is non-empty (fs events are slow under
 *  parallel test load, especially on exFAT) instead of a fixed sleep. */
async function waitForEvents(events: string[], timeoutMs = 5000, retrigger?: () => void): Promise<void> {
  const start = Date.now();
  let lastTrigger = start;
  while (events.length === 0 && Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 100));
    // Under parallel test load the initial write can race watcher setup —
    // re-fire the trigger periodically so a missed first event can't hang us.
    if (retrigger && Date.now() - lastTrigger > 700) {
      retrigger();
      lastTrigger = Date.now();
    }
  }
}


describe('FileWatcher', () => {
  let tmpDir: string;
  let watcher: FileWatcher;

  afterEach(async () => {
    if (watcher) await watcher.stop();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a new file', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
    watcher = new FileWatcher();

    const events: string[] = [];
    watcher.on('add', (filePath: string) => events.push(filePath));

    await watcher.start(tmpDir, { useGit: false });

    // Write a new file
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'hello');

    // Wait for fs event (debounced)
    await waitForEvents(events, 5000, () => fs.writeFileSync(path.join(tmpDir, `new-${Date.now()}.txt`), 'hello'));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.endsWith('new.txt'))).toBe(true);
  });

  it('detects a file change', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
    const testFile = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(testFile, 'original');

    watcher = new FileWatcher();
    const events: string[] = [];
    watcher.on('change', (filePath: string) => events.push(filePath));

    await watcher.start(tmpDir, { useGit: false });

    fs.writeFileSync(testFile, 'modified');
    await waitForEvents(events, 5000, () => fs.writeFileSync(testFile, `modified-${Date.now()}`));

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('reports git mode when .git exists', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));

    watcher = new FileWatcher();
    await watcher.start(tmpDir);

    expect(watcher.mode).toBe('git');
  });

  it('reports fs mode when no .git', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));

    watcher = new FileWatcher();
    await watcher.start(tmpDir, { useGit: false });

    expect(watcher.mode).toBe('fs');
  });
});
