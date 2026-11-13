/**
 * Regression guard for issue #222: the orgs run-log watcher in server.mjs must
 * not pass `persistent: false` to chokidar.watch(). (The original chokidar 3.6
 * internals reproduction was removed: chokidar >=4 rewrote nodefs-handler and
 * no longer has the unguarded `watcher.close.bind` path.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('server.mjs orgs watcher — #222 regression guard', () => {
  it('does not pass persistent: false to the orgs-directory chokidar.watch() call', () => {
    const serverPath = fileURLToPath(new URL('../src/ui/server.mjs', import.meta.url));
    const source = readFileSync(serverPath, 'utf8');

    const callStart = source.indexOf("chokidar.watch(_orgsDir, {");
    expect(callStart).toBeGreaterThan(-1);
    const callEnd = source.indexOf('});', callStart);
    expect(callEnd).toBeGreaterThan(callStart);
    const callSource = source.slice(callStart, callEnd);

    expect(callSource).not.toMatch(/persistent\s*:\s*false/);
  });
});
