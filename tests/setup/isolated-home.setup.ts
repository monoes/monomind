/**
 * Per-file HOME for suites that run each test file in its own process (#347).
 *
 * isolated-home.global.ts already moved the whole run off the real home; in
 * the `forks` pool this gives every test file a home of its own, so files
 * running side by side do not share ~/.monomind state, and removes it when
 * the file is done. In the `threads` pool it does nothing: a worker thread
 * can only change its own copy of process.env, while os.homedir() keeps
 * reading the process environment, so a per-file HOME there would make
 * process.env.HOME and os.homedir() disagree. A test that sets HOME itself
 * still wins, since it runs after this file.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { afterAll } from 'vitest';
import { useTestHome, useTestTmp } from './isolated-home.global.js';
import { assertNoTmpLeak } from './tmp-leak-guard.js';

if (isMainThread) {
  // Inside the run's home when the global setup made one, so the run's
  // teardown also removes homes of files whose afterAll never ran (skipped).
  const runHome = process.env.HOME;
  const parent = runHome && runHome !== process.env.MONOMIND_TEST_REAL_HOME ? runHome : tmpdir();
  const home = mkdtempSync(join(parent, 'mm-test-home-'));
  useTestHome(home);
  // A temp dir of its own inside the run's, so what this file leaves behind is counted.
  const tmp = mkdtempSync(join(tmpdir(), 'mm-test-tmp-'));
  useTestTmp(tmp);
  afterAll(() => {
    try {
      assertNoTmpLeak(tmp);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
