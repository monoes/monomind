import type { CdpClient } from './cdp.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export interface RecordOptions {
  path?: string;
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
  everyNthFrame?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface RecordingState {
  frames: string[];
  offScreencast: (() => void) | null;
  totalBytes: number;
  autoStopped: boolean;
}

// Unlike har.ts's MAX_REQUESTS_PER_SESSION cap on the analogous network-request
// buffer, the screencast frame buffer previously had no size or count cap at
// all — recording for even a few minutes at normal frame rates can accumulate
// hundreds of MB of base64-encoded JPEG data in memory, and stopRecording()'s
// single JSON.stringify() of the whole frame array can exceed V8's max string
// length and crash the process. Cap total accumulated base64 bytes (simpler to
// check per-push than re-measuring the whole array) and auto-stop recording
// once the budget is exhausted.
const MAX_SCREENCAST_BYTES = 200 * 1024 * 1024; // ~200 MB of accumulated base64 frame data

const _sessions = new Map<string, RecordingState>();

export async function startRecording(
  client: CdpClient,
  sessionId: string,
  options: RecordOptions = {}
): Promise<void> {
  const existing = _sessions.get(sessionId);
  if (existing && !existing.autoStopped) {
    throw new Error('Recording already in progress for this session');
  }
  if (existing) {
    // Previous recording hit the buffer cap and auto-stopped but was never
    // explicitly saved via stopRecording() — drop it so a fresh recording
    // can start (its frames are lost; the auto-stop log already warned the
    // caller to save via "record stop" before starting a new recording).
    _sessions.delete(sessionId);
  }

  const state: RecordingState = { frames: [], offScreencast: null, totalBytes: 0, autoStopped: false };
  _sessions.set(sessionId, state);

  state.offScreencast = client.on('Page.screencastFrame', async (params, sid) => {
    if (sid !== sessionId) return;
    const { data, sessionId: frameSessionId } = params as { data: string; sessionId: number };
    if (!state.autoStopped) {
      state.frames.push(data);
      state.totalBytes += data.length;
      if (state.totalBytes >= MAX_SCREENCAST_BYTES) {
        state.autoStopped = true;
        state.offScreencast?.();
        // eslint-disable-next-line no-console
        console.error(
          `[monobrowse] Screen recording auto-stopped: reached ${Math.round(MAX_SCREENCAST_BYTES / (1024 * 1024))}MB ` +
          `of buffered frame data (${state.frames.length} frames). Call "record stop" to save what was captured.`
        );
        await client.send('Page.stopScreencast', {}, sessionId).catch(() => {});
      }
    }
    await client.send('Page.screencastFrameAck', { sessionId: frameSessionId }, sessionId).catch(() => {});
  });

  try {
    await client.send('Page.startScreencast', {
      format: options.format ?? 'jpeg',
      quality: options.quality ?? 80,
      everyNthFrame: options.everyNthFrame ?? 1,
      ...(options.maxWidth ? { maxWidth: options.maxWidth } : {}),
      ...(options.maxHeight ? { maxHeight: options.maxHeight } : {}),
    }, sessionId);
  } catch (err) {
    state.offScreencast?.();
    _sessions.delete(sessionId);
    throw err;
  }
}

export async function stopRecording(
  client: CdpClient,
  sessionId: string,
  outputPath?: string
): Promise<string> {
  const state = _sessions.get(sessionId);
  if (!state) throw new Error('No active recording for this session');

  try {
    // If auto-stop already sent Page.stopScreencast and unsubscribed, don't
    // send it again — Chrome errors on stopping an already-stopped screencast.
    if (!state.autoStopped) {
      await client.send('Page.stopScreencast', {}, sessionId);
    }
  } finally {
    state.offScreencast?.();
    _sessions.delete(sessionId);
  }

  const path = outputPath ?? join(tmpdir(), `monomind-screencast-${Date.now()}.frames.json`);
  await writeFile(path, JSON.stringify({ frameCount: state.frames.length, frames: state.frames }));
  return path;
}

export function getRecordingStatus(sessionId: string): { recording: boolean; frames: number; autoStopped: boolean } {
  const state = _sessions.get(sessionId);
  return { recording: !!state && !state.autoStopped, frames: state?.frames.length ?? 0, autoStopped: state?.autoStopped ?? false };
}

export async function saveFrameAsPng(
  client: CdpClient,
  sessionId: string,
  frameIndex: number,
  outputPath: string
): Promise<void> {
  const state = _sessions.get(sessionId);
  if (!state || frameIndex >= state.frames.length) {
    throw new Error(`Frame ${frameIndex} not available`);
  }
  await writeFile(outputPath, Buffer.from(state.frames[frameIndex], 'base64'));
}
