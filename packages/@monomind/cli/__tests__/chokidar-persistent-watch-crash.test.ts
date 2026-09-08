/**
 * Regression test for issue #222:
 * "crash: Cannot read properties of undefined (reading 'close')"
 *
 * Root cause (fixed in commit 54d136db4): chokidar 3.6's
 * setFsWatchListener() (lib/nodefs-handler.js:149-160) has an
 * `!options.persistent` branch that does:
 *
 *     watcher = createFsWatchInstance(...);
 *     return watcher.close.bind(watcher);
 *
 * with no null check. createFsWatchInstance() (lib/nodefs-handler.js:105-123)
 * returns `undefined` whenever the underlying fs.watch() call throws
 * synchronously (ENOSPC, EMFILE, a watched path disappearing mid-scan,
 * etc.) — it catches the error, hands it to errHandler(), then falls
 * through and implicitly returns undefined. `watcher.close` on that
 * undefined is exactly the reported crash. The `persistent: true` branch a
 * few lines below (162-173) calls the same createFsWatchInstance() and
 * *does* guard it with `if (!watcher) return;`; only the `persistent: false`
 * branch is missing that guard. This is called synchronously from
 * `_watchWithNodeFs` (line 331) <- `_handleFile` (line 395) <-
 * `_addToNodeFs` (line 637) — the exact call chain in the issue's stack
 * trace.
 *
 * The orgs run-log watcher in packages/@monomind/cli/src/ui/server.mjs used
 * to pass `chokidar.watch(_orgsDir, { persistent: false, ... })`, routing
 * every per-file watch it sets up into this unguarded branch. The fix
 * simply drops `persistent: false` from that call so it takes chokidar's
 * already-guarded `persistent: true` branch instead — real chokidar's own
 * default when the option is omitted, and the shape every other chokidar
 * consumer uses.
 *
 * This test exercises real, unmodified chokidar (only mocking fs.watch to
 * throw synchronously, simulating a real OS-level watch failure — the
 * documented, sanctioned way to trigger this deterministically) and calls
 * `_watchWithNodeFs` directly, the same internal entry point named in the
 * issue's own stack trace, to prove:
 *   (a) `persistent: false` (server.mjs's PRE-FIX option) really does throw
 *       the exact reported error, synchronously, with no way for any
 *       'error' listener to intercept it — the throw happens before
 *       chokidar's error-emitting machinery is ever reached — and
 *   (b) `persistent` left at its default of `true` (server.mjs's CURRENT,
 *       fixed option — persistent is simply omitted from the call) does
 *       not throw at all.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
// Default import gets Node's real CJS `module.exports` object for 'fs' (the
// same singleton chokidar's internal `require('fs')` sees) — unlike a
// namespace import (`import * as fs`), its properties are plain, mutable
// object properties rather than locked ESM live bindings, so vi.spyOn can
// patch it.
import fsDefault from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';

const { FSWatcher } = chokidar;

function makeOrgsFixture(): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'monomind-issue222-'));
  const runsDir = join(dir, 'testorg', 'runs');
  mkdirSync(runsDir, { recursive: true });
  const filePath = join(runsDir, 'testrun.jsonl');
  writeFileSync(filePath, '{}\n');
  return { dir, filePath };
}

/**
 * Makes fs.watch() throw synchronously (simulating ENOSPC/EMFILE/a vanished
 * path) for anything under `scopedDir`, while leaving every other fs.watch
 * call — including vitest's own — untouched.
 */
function makeWatchFailFor(scopedDir: string) {
  const originalWatch = fsDefault.watch;
  return vi.spyOn(fsDefault, 'watch').mockImplementation((...args: Parameters<typeof fsDefault.watch>) => {
    const target = args[0];
    if (typeof target === 'string' && target.startsWith(scopedDir)) {
      throw new Error('ENOSPC: System limit for number of file watchers reached');
    }
    return (originalWatch as (...a: unknown[]) => unknown).apply(fsDefault, args);
  });
}

describe('chokidar orgs watcher — #222 fs.watch-failure crash', () => {
  let watchSpy: ReturnType<typeof vi.spyOn> | undefined;
  let dir: string | undefined;
  let watcher: InstanceType<typeof FSWatcher> | undefined;

  afterEach(() => {
    watchSpy?.mockRestore();
    watchSpy = undefined;
    try {
      watcher?.close();
    } catch {
      /* already broken by the test scenario — nothing to clean up */
    }
    watcher = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('throws "Cannot read properties of undefined (reading \'close\')" when persistent: false and fs.watch() fails (pre-fix reproduction)', () => {
    const fixture = makeOrgsFixture();
    dir = fixture.dir;
    watchSpy = makeWatchFailFor(fixture.dir);

    // Same options shape as server.mjs's PRE-FIX call:
    // chokidar.watch(_orgsDir, { persistent: false, ... }).
    watcher = new FSWatcher({ persistent: false, ignoreInitial: true, depth: 3 });
    watcher.on('error', () => {}); // an 'error' listener (like watchSafely) can't help — this throw never reaches it.

    // The exact internal entry point named in the issue's stack trace:
    // `_watchWithNodeFs` (nodefs-handler.js:331) is called synchronously
    // from `_handleFile` (line 395), itself called from `_addToNodeFs`
    // (line 637). Calling it directly isolates the actual bug (an
    // unguarded `watcher.close.bind(watcher)` on an undefined watcher)
    // from unrelated chokidar plumbing further up the call chain.
    expect(() => {
      (watcher as any)._nodeFsHandler._watchWithNodeFs(fixture.filePath, () => {});
    }).toThrow(/Cannot read propert(y|ies) of undefined \(reading 'close'\)/);
  });

  it('does not throw when persistent is left at its default of true — the shipped fix', () => {
    const fixture = makeOrgsFixture();
    dir = fixture.dir;
    watchSpy = makeWatchFailFor(fixture.dir);

    // Same options shape as server.mjs's CURRENT call: no `persistent: false`.
    watcher = new FSWatcher({ ignoreInitial: true, depth: 3 });
    watcher.on('error', () => {});

    expect(() => {
      (watcher as any)._nodeFsHandler._watchWithNodeFs(fixture.filePath, () => {});
    }).not.toThrow();
  });
});

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
