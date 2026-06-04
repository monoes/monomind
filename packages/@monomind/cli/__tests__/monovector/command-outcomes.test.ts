import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordCommand,
  deriveRecentSuccess,
  readCommandOutcomes,
} from '../../src/monovector/command-outcomes.js';

describe('command-outcomes store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cmd-outcomes-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('recordCommand appends an outcome with derived success', async () => {
    await recordCommand(dir, { command: 'npm test', exitCode: 0, ts: Date.now() });
    await recordCommand(dir, { command: 'npm run build', exitCode: 1, ts: Date.now() });

    const outcomes = await readCommandOutcomes(dir);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ command: 'npm test', exitCode: 0, success: true });
    expect(outcomes[1]).toMatchObject({ command: 'npm run build', exitCode: 1, success: false });
  });

  it('deriveRecentSuccess returns true when all in-window commands succeeded', async () => {
    const now = Date.now();
    await recordCommand(dir, { command: 'tsc', exitCode: 0, ts: now });
    await recordCommand(dir, { command: 'vitest', exitCode: 0, ts: now });

    expect(await deriveRecentSuccess(dir)).toBe(true);
  });

  it('deriveRecentSuccess returns false when the task ends on a failing command', async () => {
    const now = Date.now();
    await recordCommand(dir, { command: 'tsc', exitCode: 0, ts: now });
    await recordCommand(dir, { command: 'vitest', exitCode: 2, ts: now });

    expect(await deriveRecentSuccess(dir)).toBe(false);
  });

  it('deriveRecentSuccess returns true for iterate-until-green (fail immediately followed by pass)', async () => {
    const now = Date.now();
    // The COMMON shape: tests fail, then pass after a fix — no command in between.
    // Final state (last command) is the passing run.
    await recordCommand(dir, { command: 'vitest', exitCode: 1, ts: now });        // first run fails
    await recordCommand(dir, { command: 'vitest', exitCode: 0, ts: now + 1 });      // re-run passes

    // Last command decides → success. (A "last 2 must pass" rule would wrongly say false here.)
    expect(await deriveRecentSuccess(dir)).toBe(true);
  });

  it('deriveRecentSuccess tolerates a benign non-zero intermediate exit (grep no-match)', async () => {
    const now = Date.now();
    await recordCommand(dir, { command: 'grep TODO src', exitCode: 1, ts: now });   // no match → exit 1, benign
    await recordCommand(dir, { command: 'tsc', exitCode: 0, ts: now + 1 });
    await recordCommand(dir, { command: 'vitest', exitCode: 0, ts: now + 2 });

    // The benign intermediate exit-1 is not in the trailing window → success.
    expect(await deriveRecentSuccess(dir)).toBe(true);
  });

  it('deriveRecentSuccess returns null when there are no recent commands (no signal)', async () => {
    // Nothing recorded at all.
    expect(await deriveRecentSuccess(dir)).toBeNull();
  });

  it('deriveRecentSuccess respects the time window (stale commands ignored)', async () => {
    const stale = Date.now() - 600_000; // 10 min ago — outside the default 300s window
    await recordCommand(dir, { command: 'old-failing-cmd', exitCode: 1, ts: stale });

    // Stale failure is out of window → no recent signal → null, not false.
    expect(await deriveRecentSuccess(dir)).toBeNull();

    // A fresh success inside the window should now drive the derivation to true,
    // unaffected by the stale failure.
    await recordCommand(dir, { command: 'fresh-cmd', exitCode: 0, ts: Date.now() });
    expect(await deriveRecentSuccess(dir)).toBe(true);
  });

  it('readCommandOutcomes filters out stale records', async () => {
    await recordCommand(dir, { command: 'stale', exitCode: 0, ts: Date.now() - 600_000 });
    await recordCommand(dir, { command: 'fresh', exitCode: 0, ts: Date.now() });

    const outcomes = await readCommandOutcomes(dir);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].command).toBe('fresh');
  });
});
