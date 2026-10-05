/**
 * A drop-in `mkdtempSync` for test files: the directories it makes are removed
 * when the file is done, so a test needs no cleanup of its own for them. Import
 * it instead of `mkdtempSync` from node:fs; the leak guard (tmp-leak-guard.ts)
 * counts whatever a file still leaves in TMPDIR after that.
 */
import { mkdtempSync as makeTempDir, rmSync } from 'node:fs';
import { afterAll } from 'vitest';

const made: string[] = [];

afterAll(() => {
  for (const dir of made.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a directory the test made unreadable: the per-file TMPDIR removal retries it */
    }
  }
});

export function mkdtempSync(prefix: string): string {
  const dir = makeTempDir(prefix);
  made.push(dir);
  return dir;
}
