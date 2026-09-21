// The browser detector bundle is generated from cli/engine sources and is
// what pages actually run. It once fell behind its sources by a whole fix
// (splitTopLevelCommas), unnoticed, so keep it provably in sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('cli/engine/detect-antipatterns-browser.js matches its sources', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts/build-browser-detector.js'), '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
