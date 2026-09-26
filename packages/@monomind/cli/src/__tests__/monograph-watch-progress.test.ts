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
 * #338: surfacing the skip was not enough — the skipped batch was dropped and
 * "Rebuild complete." printed anyway, so the graph never saw the change. The
 * watch command now retries a lock-skipped batch and reports what each
 * rebuild actually did.
 *
 * Mocks the watcher and `buildAsync` (same pattern as
 * monograph-integration.test.ts) so this does not depend on a real file
 * watcher or a real lock collision; the rebuild queue is the real one.
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

const built = {
  status: 'built' as const,
  nodes: { before: 10, after: 12 },
  edges: { before: 5, after: 6 },
};
// First call: acquireBuildLock() finds the lock already held — the scenario
// cli-qa reproduced (round-1 logs cliqa-17..19). Second call: the retry builds.
const mockBuildAsync = vi.fn(async (_root: string, _opts: unknown): Promise<unknown> => built);

// A plain constructor function (not `class`) so it can return the shared
// FakeWatcher instance without tripping the "constructor should not return a
// value" lint rule that applies to `class` constructors.
function MockMonographWatcher() {
  state.watcherInstance = new FakeWatcher();
  return state.watcherInstance;
}

vi.mock('@monoes/monograph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@monoes/monograph')>()),
  MonographWatcher: MockMonographWatcher,
  buildAsync: mockBuildAsync,
}));

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
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
  mockBuildAsync.mockResolvedValueOnce({
    status: 'skipped',
    reason: 'locked',
    message: 'Another build is in progress — skipping',
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('monograph watch — build-lock skip', () => {
  it('retries a lock-skipped rebuild and reports what the retry changed', async () => {
    const { output } = await import('../output.js');
    const { default: monographCommand } = await import('../commands/monograph.js');
    const watch = monographCommand.subcommands?.find((c) => c.name === 'watch');
    if (!watch?.action) throw new Error('watch subcommand not found');

    const writelnSpy = vi.spyOn(output, 'writeln');

    const actionPromise = watch.action(ctx({ path: root, timeout: 4 }));

    // Let the dynamic import + watcher.start() mock resolve so `watcherInstance`
    // is constructed before we simulate a file change. The dynamic import can
    // take more than one microtask/macrotask tick, so poll instead of a single
    // setImmediate.
    await waitFor(() => state.watcherInstance !== undefined);

    (state.watcherInstance as FakeWatcher).emit('monograph:updated', [join(root, 'changed.ts')]);

    await actionPromise;

    expect(mockBuildAsync).toHaveBeenCalledTimes(2);
    const lines = writelnSpy.mock.calls.map((c) => String(c[0] ?? ''));
    const deferred = lines.findIndex((l) => l.includes('another build is in progress'));
    const updated = lines.findIndex(
      (l) =>
        l.includes('Graph updated') &&
        l.includes('nodes +2 (now 12)') &&
        l.includes('edges +1 (now 6)'),
    );
    expect(deferred).toBeGreaterThan(-1);
    expect(updated).toBeGreaterThan(deferred);
    expect(lines.some((l) => l.includes('Rebuild complete'))).toBe(false);
  }, 10000);

  it('drops its Ctrl+C listener while a rebuild runs, so Ctrl+C kills it instead of waiting out the build (#340)', async () => {
    const { default: monographCommand } = await import('../commands/monograph.js');
    const watch = monographCommand.subcommands?.find((c) => c.name === 'watch');
    if (!watch?.action) throw new Error('watch subcommand not found');

    const before = process.listenerCount('SIGINT');
    const duringBuild: number[] = [];
    mockBuildAsync.mockReset();
    mockBuildAsync.mockImplementation(async () => {
      duringBuild.push(process.listenerCount('SIGINT'));
      return built;
    });

    const actionPromise = watch.action(ctx({ path: root, timeout: 1 }));
    await waitFor(() => state.watcherInstance !== undefined);
    const idle = process.listenerCount('SIGINT');
    (state.watcherInstance as FakeWatcher).emit('monograph:updated', [join(root, 'changed.ts')]);
    await waitFor(() => duringBuild.length === 1);
    const afterBuild = process.listenerCount('SIGINT');
    await actionPromise;

    expect(idle).toBe(before + 1);
    expect(duringBuild).toEqual([before]);
    expect(afterBuild).toBe(before + 1);
  }, 10000);
});
