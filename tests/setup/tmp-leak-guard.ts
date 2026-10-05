/**
 * Fails a test file that leaks temp entries (#leak). isolated-home.setup.ts
 * gives every forked test file its own TMPDIR; whatever is left in it when the
 * file is done is a leak (the run's teardown removes it either way, so the
 * developer's /tmp stays clean, but the leak is still a bug in the test).
 */
import { existsSync, readdirSync } from 'node:fs';

/** Entries a file may leave behind before it fails (a stray lock or two). */
export const TMP_LEAK_LIMIT = 5;

/** Made by Node, the Claude CLI and its sandbox runtime, not by a test. */
const TOOL_OWNED = /^(node-compile-cache|claude-\d+|srt-mux-.*\.sock)$/;

export function leakedEntries(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => !TOOL_OWNED.test(n))
        .sort()
    : [];
}

/** Throws when `dir` holds more than `limit` entries. */
export function assertNoTmpLeak(dir: string, limit = TMP_LEAK_LIMIT): void {
  const left = leakedEntries(dir);
  if (left.length <= limit) return;
  const shown = left.slice(0, 10).join(', ');
  throw new Error(
    `test file leaked ${left.length} entries into TMPDIR (limit ${limit}): ${shown}${left.length > 10 ? ', …' : ''}. ` +
      'Remove what a test creates (afterEach/afterAll) or keep it under a directory the test removes.',
  );
}
