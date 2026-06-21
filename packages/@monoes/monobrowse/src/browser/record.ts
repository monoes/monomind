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
}

const _sessions = new Map<string, RecordingState>();

export async function startRecording(
  client: CdpClient,
  sessionId: string,
  options: RecordOptions = {}
): Promise<void> {
  if (_sessions.has(sessionId)) {
    throw new Error('Recording already in progress for this session');
  }

  const state: RecordingState = { frames: [], offScreencast: null };
  _sessions.set(sessionId, state);

  state.offScreencast = client.on('Page.screencastFrame', async (params, sid) => {
    if (sid !== sessionId) return;
    const { data, sessionId: frameSessionId } = params as { data: string; sessionId: number };
    state.frames.push(data);
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
    await client.send('Page.stopScreencast', {}, sessionId);
  } finally {
    state.offScreencast?.();
    _sessions.delete(sessionId);
  }

  const path = outputPath ?? join(tmpdir(), `monomind-screencast-${Date.now()}.frames.json`);
  await writeFile(path, JSON.stringify({ frameCount: state.frames.length, frames: state.frames }));
  return path;
}

export function getRecordingStatus(sessionId: string): { recording: boolean; frames: number } {
  const state = _sessions.get(sessionId);
  return { recording: !!state, frames: state?.frames.length ?? 0 };
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
