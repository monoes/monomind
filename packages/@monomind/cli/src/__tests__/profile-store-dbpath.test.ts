/**
 * The guard that makes per-profile stores safe: `memory-bridge.getDbPath`
 * accepts a profile's brain directory.
 *
 * This is a separate file from profile-store.test.ts because it must run
 * against the REAL bridge, and it is worth its own test because the failure
 * mode is silent. getDbPath does not throw on a path it dislikes — it
 * returns the DEFAULT store instead. A profile directory placed anywhere
 * outside the project, the per-project data dir or the global brain would
 * therefore not fail loudly; every profile's captures would simply pile up
 * in one database, which is the precise thing this feature exists to
 * prevent. Hence: profile brains live inside the global brain, and this
 * test is what keeps that true.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = fs.mkdtempSync(join(os.tmpdir(), 'mm-profile-db-'));
const BRAIN = join(ROOT, 'global-brain');
process.env.MONOMIND_GLOBAL_BRAIN_DIR = BRAIN;

afterAll(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('a profile brain must be INSIDE the global brain, or getDbPath silently swaps the store', () => {
  it('accepts a brain inside the global brain and resolves it to itself', async () => {
    const { profileBrainDir } = await import('../knowledge/profile-store.js');
    const { bridgeGetDbPath, getGlobalBrainDir } = await import('../memory/memory-bridge.js');

    const dir = profileBrainDir('work');
    expect(dir).toBe(join(BRAIN, 'profiles', 'work'));
    expect(bridgeGetDbPath(dir)).toBe(fs.realpathSync(dir as string));

    // Two profiles are two directories, so two backends.
    expect(bridgeGetDbPath(profileBrainDir('personal'))).not.toBe(bridgeGetDbPath(dir));
    // And neither is the global brain itself.
    expect(bridgeGetDbPath(dir)).not.toBe(getGlobalBrainDir());
  });

  it('silently substitutes the default store for a brain outside it — no error, every profile in one database', async () => {
    const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
    const outside = join(ROOT, 'elsewhere', 'work');
    fs.mkdirSync(outside, { recursive: true });

    // Silently the default store — no error, no warning, every profile's
    // captures in one database. This is the reason for the layout.
    expect(bridgeGetDbPath(outside)).not.toBe(outside);
  });
});
