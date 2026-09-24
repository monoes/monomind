/**
 * `monograph watch` build-lock skip visibility (cli-qa finding, 2.16.2 round 1).
 *
 * The watcher's `monograph:updated` handler called `buildAsync()` without an
 * `onProgress` callback, unlike the `build`/`wiki` command call sites. When
 * `acquireBuildLock()` (orchestrator.ts) can't get the lock, or the index is
 * already fresh, it reports that via `onProgress?.({ phase: 'skip', ... })` —
 * with nothing wired up here, that message was silently dropped and `watch`
 * looked permanently hung after a rebuild was skipped, with zero log output.
 *
 * Mocks `@monoes/monograph` (same pattern as monograph-integration.test.ts)
 * so this runs in milliseconds and does not depend on a real file watcher or
 * a real lock collision — it only proves the CLI wires onProgress through
 * and surfaces a 'skip' phase message to the user.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../types.js';

// `vi.hoisted` runs before the hoisted `vi.mock` factory below, and both share
// this same binding — a plain module-scope `let` does NOT reliably share
// state with a hoisted vi.mock factory (they end up as distinct bindings).
const state = vi.hoisted(() => ({
  watcherInstance: undefined as InstanceType<typeof EventEmitter> | undefined,
}));

class FakeWatcher extends EventEmitter {
  start = vi.fn(async () => {});
  stop = vi.fn();
}

const mockBuildAsync = vi.fn(
  async (
    _root: string,
    opts: { onProgress?: (p: { phase: string; message?: string }) => void },
  ) => {
    // Simulate acquireBuildLock() finding the lock already held — the exact
    // scenario cli-qa reproduced (round-1 logs cliqa-17..19).
    opts.onProgress?.({ phase: 'skip', message: 'Another build is in progress — skipping' });
  },
);

// A plain constructor function (not `class`) so it can return the shared
// FakeWatcher instance without tripping the "constructor should not return a
// value" lint rule that applies to `class` constructors.
function MockMonographWatcher() {
  state.watcherInstance = new FakeWatcher();
  return state.watcherInstance;
}

vi.mock('@monoes/monograph', () => ({
  MonographWatcher: MockMonographWatcher,
  buildAsync: mockBuildAsync,
}));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let root: string;

function ctx(flags: Record<string, string | boolean | number>): CommandContext {
  return {
    args: [],
    flags: { _: [], ...flags },
    cwd: root,
    interactive: false,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mg-watch-progress-'));
  state.watcherInstance = undefined;
  mockBuildAsync.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('monograph watch — build-lock skip visibility', () => {
  it('reports a skipped rebuild instead of going silent', async () => {
    const { output } = await import('../output.js');
    const { default: monographCommand } = await import('../commands/monograph.js');
    const watch = monographCommand.subcommands?.find((c) => c.name === 'watch');
    if (!watch?.action) throw new Error('watch subcommand not found');

    const writelnSpy = vi.spyOn(output, 'writeln');

    const actionPromise = watch.action(ctx({ path: root, timeout: 1 }));

    // Let the dynamic import + watcher.start() mock resolve so `watcherInstance`
    // is constructed before we simulate a file change. The dynamic import can
    // take more than one microtask/macrotask tick, so poll instead of a single
    // setImmediate.
    await waitFor(() => state.watcherInstance !== undefined);

    (state.watcherInstance as FakeWatcher).emit('monograph:updated', ['src/changed.ts']);

    await actionPromise;

    expect(mockBuildAsync).toHaveBeenCalledTimes(1);
    const [, buildOpts] = mockBuildAsync.mock.calls[0];
    expect(typeof buildOpts.onProgress).toBe('function');

    const lines = writelnSpy.mock.calls.map((c) => String(c[0] ?? ''));
    expect(lines.some((l) => l.includes('Another build is in progress — skipping'))).toBe(true);
  });
});
