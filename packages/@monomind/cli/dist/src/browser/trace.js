import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
const DEFAULT_CATEGORIES = [
    '-*',
    'devtools.timeline',
    'v8.execute',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'toplevel',
    'blink.console',
    'blink.user_timing',
    'latencyInfo',
    'disabled-by-default-devtools.timeline.stack',
];
const _sessions = new Map();
export async function startTrace(client, sessionId, options = {}) {
    if (_sessions.has(sessionId)) {
        throw new Error('Trace already in progress for this session');
    }
    const events = [];
    const offData = client.on('Tracing.dataCollected', (params, sid) => {
        if (sid !== sessionId)
            return;
        const value = params.value;
        if (Array.isArray(value))
            events.push(...value);
    });
    _sessions.set(sessionId, { events, offData });
    const cats = [...(options.categories ?? DEFAULT_CATEGORIES)];
    if (options.screenshots)
        cats.push('disabled-by-default-devtools.screenshot');
    try {
        await client.send('Tracing.start', {
            traceConfig: {
                includedCategories: cats.filter((c) => !c.startsWith('-')),
                excludedCategories: cats.filter((c) => c.startsWith('-')).map((c) => c.slice(1)),
            },
        }, sessionId);
    }
    catch (err) {
        offData();
        _sessions.delete(sessionId);
        throw err;
    }
}
export async function stopTrace(client, sessionId, outputPath) {
    const state = _sessions.get(sessionId);
    if (!state)
        throw new Error('No active trace for this session');
    try {
        const [completePromise, cancelOnce] = client.onceWithOff('Tracing.tracingComplete', sessionId);
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                cancelOnce();
                reject(new Error('Timeout waiting for Tracing.tracingComplete'));
            }, 30_000);
        });
        try {
            await client.send('Tracing.end', {}, sessionId);
            await Promise.race([completePromise, timeoutPromise]);
        }
        catch (err) {
            cancelOnce();
            throw err;
        }
        finally {
            clearTimeout(timeoutHandle);
        }
    }
    finally {
        state.offData();
        _sessions.delete(sessionId);
    }
    const trace = {
        traceEvents: state.events,
        metadata: { 'clock-offset-since-epoch': Date.now() },
    };
    const path = outputPath ?? join(tmpdir(), `monomind-trace-${Date.now()}.json`);
    await writeFile(path, JSON.stringify(trace));
    return path;
}
export function getTraceStatus(sessionId) {
    return _sessions.has(sessionId);
}
//# sourceMappingURL=trace.js.map