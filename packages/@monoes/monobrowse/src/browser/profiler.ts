import type { CdpClient } from './cdp.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export interface ProfilerOptions {
  path?: string;
  samplingInterval?: number;
}

const _sessions = new Set<string>();
const _heapSessions = new Set<string>();

export async function startCpuProfile(
  client: CdpClient,
  sessionId: string,
  options: ProfilerOptions = {}
): Promise<void> {
  if (_sessions.has(sessionId)) {
    throw new Error('CPU profiler already running for this session');
  }
  await client.send('Profiler.enable', {}, sessionId);
  if (options.samplingInterval !== undefined) {
    await client.send('Profiler.setSamplingInterval', { interval: options.samplingInterval }, sessionId);
  }
  await client.send('Profiler.start', {}, sessionId);
  _sessions.add(sessionId);
}

export async function stopCpuProfile(
  client: CdpClient,
  sessionId: string,
  outputPath?: string
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
  outputPath?: string
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
    await new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        off2();
        reject(new Error('Timeout waiting for heap snapshot (120s)'));
      }, 120_000);
      const off2 = client.on('HeapProfiler.reportHeapSnapshotProgress', (params, sid) => {
        if (sid !== sessionId) return;
        if (params.finished) { clearTimeout(timeoutHandle); off2(); resolve(); }
      });
      client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: true }, sessionId)
        .catch((err) => { clearTimeout(timeoutHandle); off2(); reject(err); });
    });
  } finally {
    off();
    _heapSessions.delete(sessionId);
    await client.send('HeapProfiler.disable', {}, sessionId).catch(() => {});
  }

  const path = outputPath ?? join(tmpdir(), `monomind-heap-${Date.now()}.heapsnapshot`);
  await writeFile(path, chunks.join(''));
  return path;
}
