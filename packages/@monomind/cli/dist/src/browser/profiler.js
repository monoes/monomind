import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
const _sessions = new Set();
const _heapSessions = new Set();
export async function startCpuProfile(client, sessionId, options = {}) {
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
export async function stopCpuProfile(client, sessionId, outputPath) {
    if (!_sessions.has(sessionId)) {
        throw new Error('No active CPU profiler for this session');
    }
    let result;
    try {
        result = await client.send('Profiler.stop', {}, sessionId);
    }
    finally {
        _sessions.delete(sessionId);
    }
    // Disable after capturing the profile so a disable failure doesn't discard valid data
    await client.send('Profiler.disable', {}, sessionId).catch(() => { });
    const path = outputPath ?? join(tmpdir(), `monomind-profile-${Date.now()}.cpuprofile`);
    await writeFile(path, JSON.stringify(result.profile));
    return path;
}
export function isProfilingActive(sessionId) {
    return _sessions.has(sessionId);
}
export async function startHeapSnapshot(client, sessionId, outputPath) {
    if (_heapSessions.has(sessionId)) {
        throw new Error('Heap snapshot already in progress for this session');
    }
    _heapSessions.add(sessionId);
    await client.send('HeapProfiler.enable', {}, sessionId);
    const chunks = [];
    const off = client.on('HeapProfiler.addHeapSnapshotChunk', (params, sid) => {
        if (sid !== sessionId)
            return;
        chunks.push(params.chunk);
    });
    try {
        await new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                off2();
                reject(new Error('Timeout waiting for heap snapshot (120s)'));
            }, 120_000);
            const off2 = client.on('HeapProfiler.reportHeapSnapshotProgress', (params, sid) => {
                if (sid !== sessionId)
                    return;
                if (params.finished) {
                    clearTimeout(timeoutHandle);
                    off2();
                    resolve();
                }
            });
            client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: true }, sessionId)
                .catch((err) => { clearTimeout(timeoutHandle); off2(); reject(err); });
        });
    }
    finally {
        off();
        _heapSessions.delete(sessionId);
        await client.send('HeapProfiler.disable', {}, sessionId).catch(() => { });
    }
    const path = outputPath ?? join(tmpdir(), `monomind-heap-${Date.now()}.heapsnapshot`);
    await writeFile(path, chunks.join(''));
    return path;
}
//# sourceMappingURL=profiler.js.map