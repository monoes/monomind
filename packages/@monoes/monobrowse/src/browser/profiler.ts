import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CdpClient } from './cdp.js';

export interface ProfilerOptions {
  path?: string;
  samplingInterval?: number;
}

/** Heap snapshots on a large page take far longer than the 30s CDP default. */
const HEAP_SNAPSHOT_TIMEOUT_MS = 120_000;

const _sessions = new Set<string>();
const _heapSessions = new Set<string>();

export async function startCpuProfile(
  client: CdpClient,
  sessionId: string,
  options: ProfilerOptions = {},
): Promise<void> {
  if (_sessions.has(sessionId)) {
    throw new Error('CPU profiler already running for this session');
  }
  await client.send('Profiler.enable', {}, sessionId);
  if (options.samplingInterval !== undefined) {
    await client.send(
      'Profiler.setSamplingInterval',
      { interval: options.samplingInterval },
      sessionId,
    );
  }
  await client.send('Profiler.start', {}, sessionId);
  _sessions.add(sessionId);
}

export async function stopCpuProfile(
  client: CdpClient,
  sessionId: string,
  outputPath?: string,
): Promise<string> {
  if (!_sessions.has(sessionId)) {
    throw new Error('No active CPU profiler for this session');
  }
  let result: { profile: unknown };
  try {
    result = await client.send<{ profile: unknown }>('Profiler.stop', {}, sessionId);
  } finally {
    _sessions.delete(sessionId);
  }

  // Disable after capturing the profile so a disable failure doesn't discard valid data
  await client.send('Profiler.disable', {}, sessionId).catch(() => {});

  const path = outputPath ?? join(tmpdir(), `monomind-profile-${Date.now()}.cpuprofile`);
  await writeFile(path, JSON.stringify(result!.profile));
  return path;
}

export function isProfilingActive(sessionId: string): boolean {
  return _sessions.has(sessionId);
}

export async function startHeapSnapshot(
  client: CdpClient,
  sessionId: string,
  outputPath?: string,
): Promise<string> {
  if (_heapSessions.has(sessionId)) {
    throw new Error('Heap snapshot already in progress for this session');
  }
  _heapSessions.add(sessionId);
  await client.send('HeapProfiler.enable', {}, sessionId);

  const chunks: string[] = [];
  const off = client.on('HeapProfiler.addHeapSnapshotChunk', (params, sid) => {
    if (sid !== sessionId) return;
    chunks.push(params.chunk as string);
  });

  try {
    // Resolve on takeHeapSnapshot's own RESPONSE, not on
    // `HeapProfiler.reportHeapSnapshotProgress` with finished:true. Chrome
    // emits that progress event once it has finished WALKING the heap, which
    // is before it has streamed a single addHeapSnapshotChunk (verified
    // against Chrome 153) — so resolving there detached the chunk listener in
    // the `finally` below and wrote a 0-byte snapshot every single time. The
    // command response is the only signal that every chunk has been sent.
    //
    // reportProgress is off for the same reason: nothing consumes those
    // events any more, and they are pure noise on the wire.
    await client.send(
      'HeapProfiler.takeHeapSnapshot',
      { reportProgress: false },
      sessionId,
      HEAP_SNAPSHOT_TIMEOUT_MS,
    );
  } finally {
    off();
    _heapSessions.delete(sessionId);
    await client.send('HeapProfiler.disable', {}, sessionId).catch(() => {});
  }

  // A zero-chunk snapshot is not a snapshot. Writing the empty file anyway is
  // how this bug stayed invisible — the caller got a path, and only noticed
  // when DevTools refused to load it.
  if (chunks.length === 0) {
    throw new Error(
      'Heap snapshot produced no data — Chrome accepted HeapProfiler.takeHeapSnapshot but sent no chunks',
    );
  }

  const path = outputPath ?? join(tmpdir(), `monomind-heap-${Date.now()}.heapsnapshot`);
  await writeFile(path, chunks.join(''));
  return path;
}
