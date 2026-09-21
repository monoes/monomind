/**
 * Regression cover for the 0-byte heap snapshot.
 *
 * Chrome emits `HeapProfiler.reportHeapSnapshotProgress` with finished:true
 * BEFORE it streams a single `addHeapSnapshotChunk` (verified against Chrome
 * 153). startHeapSnapshot used to resolve on that progress event, detach its
 * chunk listener and write an empty file every time. The stub below replays
 * that exact ordering, so a regression fails here rather than in a profiling
 * session nobody notices until DevTools refuses to load the snapshot.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import { startHeapSnapshot } from '../browser/profiler.js';

type Listener = (params: Record<string, unknown>, sessionId?: string) => void;

interface StubOptions {
  /** Chunks Chrome streams, in order. */
  chunks?: string[];
  /** sessionId Chrome tags the chunk events with (defaults to the caller's). */
  chunkSessionId?: string;
  /** Emit the misleading finished:true progress event before the chunks. */
  emitProgressFirst?: boolean;
}

/**
 * A CdpClient that replays Chrome's real takeHeapSnapshot sequence: progress
 * events first, then the chunks, and only then the command response.
 */
function heapClient(sessionId: string, options: StubOptions = {}) {
  const { chunks = ['{"snapshot":', '{"node_count":2}', '}'], emitProgressFirst = true } = options;
  const listeners = new Map<string, Set<Listener>>();
  const calls: string[] = [];

  const emit = (event: string, params: Record<string, unknown>, sid?: string) => {
    for (const fn of listeners.get(event) ?? []) fn(params, sid);
  };

  // Chrome delivers each of these in its own WebSocket frame, so the stub
  // yields between them. Emitting synchronously would paper over the very
  // bug this file exists to catch: the buggy implementation resolved on the
  // progress event, and only lost the chunks because they arrived a turn
  // later, after its `finally` had detached the listener.
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  const client = {
    on: vi.fn((event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return () => listeners.get(event)?.delete(fn);
    }),
    send: vi.fn(async (method: string, _params?: unknown, _sid?: string) => {
      calls.push(method);
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        if (emitProgressFirst) {
          emit(
            'HeapProfiler.reportHeapSnapshotProgress',
            { done: 1, total: 1, finished: true },
            sessionId,
          );
          await tick();
        }
        for (const chunk of chunks) {
          emit('HeapProfiler.addHeapSnapshotChunk', { chunk }, options.chunkSessionId ?? sessionId);
          await tick();
        }
      }
      return {};
    }),
  } as unknown as CdpClient;

  return { client, calls, listeners };
}

const dirs: string[] = [];
async function outPath(name = 'heap.heapsnapshot'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'monobrowse-heap-'));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

let seq = 0;
const nextSession = () => `sid-${++seq}`;

describe('startHeapSnapshot', () => {
  it('writes every streamed chunk, not an empty file', async () => {
    const path = await outPath();
    const sid = nextSession();
    const { client } = heapClient(sid);

    const written = await startHeapSnapshot(client, sid, path);

    expect(written).toBe(path);
    const contents = await readFile(path, 'utf8');
    expect(contents).toBe('{"snapshot":{"node_count":2}}');
    expect(contents.length).toBeGreaterThan(0);
  });

  it('does not resolve on the finished progress event that precedes the chunks', async () => {
    // The regression: with emitProgressFirst the old implementation resolved
    // before any chunk arrived. Ordering is the whole point of this case.
    const path = await outPath();
    const sid = nextSession();
    const { client } = heapClient(sid, {
      emitProgressFirst: true,
      chunks: ['a'.repeat(64), 'b'.repeat(64)],
    });

    await startHeapSnapshot(client, sid, path);

    expect((await readFile(path, 'utf8')).length).toBe(128);
  });

  it('works when Chrome sends no progress events at all', async () => {
    const path = await outPath();
    const sid = nextSession();
    const { client } = heapClient(sid, { emitProgressFirst: false, chunks: ['{}'] });
    await expect(startHeapSnapshot(client, sid, path)).resolves.toBe(path);
    await expect(readFile(path, 'utf8')).resolves.toBe('{}');
  });

  it('asks Chrome not to report progress, since nothing consumes it', async () => {
    const path = await outPath();
    const sid = nextSession();
    const { client } = heapClient(sid);
    await startHeapSnapshot(client, sid, path);
    const take = (client.send as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === 'HeapProfiler.takeHeapSnapshot',
    );
    expect(take?.[1]).toEqual({ reportProgress: false });
  });

  it('enables and disables the heap profiler around the capture', async () => {
    const path = await outPath();
    const sid = nextSession();
    const { client, calls } = heapClient(sid);
    await startHeapSnapshot(client, sid, path);
    expect(calls).toEqual([
      'HeapProfiler.enable',
      'HeapProfiler.takeHeapSnapshot',
      'HeapProfiler.disable',
    ]);
  });

  it('ignores chunks belonging to another session', async () => {
    const path = await outPath();
    const sid = nextSession();
    const { client } = heapClient(sid, { chunkSessionId: 'other-session' });
    await expect(startHeapSnapshot(client, sid, path)).rejects.toThrow(/no data/i);
  });

  it('fails loudly instead of writing a 0-byte snapshot', async () => {
    const path = await outPath();
    const sid = nextSession();
    const { client } = heapClient(sid, { chunks: [] });
    await expect(startHeapSnapshot(client, sid, path)).rejects.toThrow(/produced no data/);
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });

  it('detaches its chunk listener once the snapshot is done', async () => {
    const path = await outPath();
    const sid = nextSession();
    const { client, listeners } = heapClient(sid);
    await startHeapSnapshot(client, sid, path);
    expect(listeners.get('HeapProfiler.addHeapSnapshotChunk')?.size ?? 0).toBe(0);
  });

  it('releases the in-progress guard after a failure, so a retry is possible', async () => {
    const failing = {
      on: vi.fn(() => () => {}),
      send: vi.fn(async (method: string) => {
        if (method === 'HeapProfiler.takeHeapSnapshot') throw new Error('target crashed');
        return {};
      }),
    } as unknown as CdpClient;

    const sid = nextSession();
    await expect(startHeapSnapshot(failing, sid)).rejects.toThrow('target crashed');

    const path = await outPath();
    const { client } = heapClient(sid);
    await expect(startHeapSnapshot(client, sid, path)).resolves.toBe(path);
  });
});
