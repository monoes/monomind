import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
const _sessions = new Map();
export async function startRecording(client, sessionId, options = {}) {
    if (_sessions.has(sessionId)) {
        throw new Error('Recording already in progress for this session');
    }
    const state = { frames: [], offScreencast: null };
    _sessions.set(sessionId, state);
    state.offScreencast = client.on('Page.screencastFrame', async (params, sid) => {
        if (sid !== sessionId)
            return;
        const { data, sessionId: frameSessionId } = params;
        state.frames.push(data);
        await client.send('Page.screencastFrameAck', { sessionId: frameSessionId }, sessionId).catch(() => { });
    });
    try {
        await client.send('Page.startScreencast', {
            format: options.format ?? 'jpeg',
            quality: options.quality ?? 80,
            everyNthFrame: options.everyNthFrame ?? 1,
            ...(options.maxWidth ? { maxWidth: options.maxWidth } : {}),
            ...(options.maxHeight ? { maxHeight: options.maxHeight } : {}),
        }, sessionId);
    }
    catch (err) {
        state.offScreencast?.();
        _sessions.delete(sessionId);
        throw err;
    }
}
export async function stopRecording(client, sessionId, outputPath) {
    const state = _sessions.get(sessionId);
    if (!state)
        throw new Error('No active recording for this session');
    try {
        await client.send('Page.stopScreencast', {}, sessionId);
    }
    finally {
        state.offScreencast?.();
        _sessions.delete(sessionId);
    }
    const path = outputPath ?? join(tmpdir(), `monomind-screencast-${Date.now()}.frames.json`);
    await writeFile(path, JSON.stringify({ frameCount: state.frames.length, frames: state.frames }));
    return path;
}
export function getRecordingStatus(sessionId) {
    const state = _sessions.get(sessionId);
    return { recording: !!state, frames: state?.frames.length ?? 0 };
}
export async function saveFrameAsPng(client, sessionId, frameIndex, outputPath) {
    const state = _sessions.get(sessionId);
    if (!state || frameIndex >= state.frames.length) {
        throw new Error(`Frame ${frameIndex} not available`);
    }
    await writeFile(outputPath, Buffer.from(state.frames[frameIndex], 'base64'));
}
//# sourceMappingURL=record.js.map