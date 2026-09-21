/**
 * RIG-11 — recorded evidence around a failure.
 *
 * Only the pure half is tested here (selection and timeline assembly); the
 * recorder itself is exercised with a stub CDP client, so nothing launches
 * Chrome. The bounds are the point: a report must never grow without limit,
 * however long the run or however noisy the page.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import {
  type BuildEvidenceInput,
  buildEvidence,
  findFocusOffset,
  type RawFrame,
  selectFrames,
  startEvidenceRecorder,
} from '../report/evidence.js';

const START = 1_000_000;

function frames(count: number, spacingMs = 100, bytes = 1000): RawFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    offsetMs: i * spacingMs,
    data: 'x'.repeat(bytes),
    bytes,
  }));
}

function input(partial: Partial<BuildEvidenceInput> = {}): BuildEvidenceInput {
  return {
    reason: 'budget-failure',
    startedAtMs: START,
    frames: frames(20),
    console: [],
    pageErrors: [],
    requests: [],
    failures: [],
    ...partial,
  };
}

describe('findFocusOffset', () => {
  it('picks the earliest hard error as the moment to explain', () => {
    const offset = findFocusOffset(
      input({
        console: [
          { type: 'error', text: 'late', timestamp: START + 1800 },
          { type: 'error', text: 'early', timestamp: START + 600 },
        ],
        pageErrors: [{ text: 'uncaught', timestamp: START + 900 }],
      }),
    );
    expect(offset).toBe(600);
  });

  it('ignores console warnings — a warning is not the failure', () => {
    expect(
      findFocusOffset(input({ console: [{ type: 'warn', text: 'meh', timestamp: START + 100 }] })),
    ).toBeNull();
  });

  it('uses a failed request when it carries a clock reading', () => {
    expect(
      findFocusOffset(
        input({
          requests: [
            { url: 'https://a.test/x', method: 'GET', failed: true, startedAtMs: START + 450 },
          ],
        }),
      ),
    ).toBe(450);
  });

  it('skips a failed request with no clock reading rather than guessing', () => {
    expect(
      findFocusOffset(
        input({ requests: [{ url: 'https://a.test/x', method: 'GET', failed: true }] }),
      ),
    ).toBeNull();
  });

  it('has no focus when the breach is a load-wide metric', () => {
    expect(
      findFocusOffset(
        input({ failures: [{ budget: 'lcpMs', expected: '<= 2500ms', actual: '4100ms' }] }),
      ),
    ).toBeNull();
  });
});

describe('selectFrames', () => {
  it('keeps the frames nearest the failure', () => {
    const picked = selectFrames(frames(40), 2000, { maxFrames: 5 });
    expect(picked.frames.map((f) => f.offsetMs)).toEqual([1800, 1900, 2000, 2100, 2200]);
    expect(picked.dropped).toBe(35);
  });

  it('samples the whole run when there is no single moment to centre on', () => {
    const picked = selectFrames(frames(21), null, { maxFrames: 5 });
    expect(picked.frames.map((f) => f.offsetMs)).toEqual([0, 500, 1000, 1500, 2000]);
  });

  it('returns the frames in time order even though it ranks them by distance', () => {
    const picked = selectFrames(frames(40), 2000, { maxFrames: 7 });
    const offsets = picked.frames.map((f) => f.offsetMs);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it('falls back to the nearest frames when none fall inside the window', () => {
    const picked = selectFrames(frames(10), 60_000, { maxFrames: 3, windowMs: 500 });
    expect(picked.frames.map((f) => f.offsetMs)).toEqual([700, 800, 900]);
  });

  it('enforces the byte budget by evicting the least relevant frame first', () => {
    const picked = selectFrames(frames(40, 100, 1000), 2000, { maxFrames: 10, maxBytes: 3000 });
    expect(picked.frames.length).toBe(3);
    expect(picked.frames.map((f) => f.offsetMs)).toEqual([1900, 2000, 2100]);
  });

  it('handles an empty recording without throwing', () => {
    expect(selectFrames([], 100)).toEqual({ frames: [], dropped: 0 });
  });
});

describe('buildEvidence', () => {
  it('attaches frames around the failure and lines the events up against them', () => {
    const evidence = buildEvidence(
      input({
        frames: frames(40),
        console: [{ type: 'error', text: 'Cannot read x of undefined', timestamp: START + 2000 }],
        requests: [
          {
            url: 'https://api.test/cart',
            method: 'GET',
            status: 503,
            failed: true,
            startedAtMs: START + 2100,
          },
        ],
        failures: [{ budget: 'maxConsoleErrors', expected: '<= 0', actual: '1' }],
        select: { maxFrames: 5 },
      }),
    );

    expect(evidence.focusOffsetMs).toBe(2000);
    expect(evidence.frames.length).toBe(5);
    expect(evidence.frames[0].dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);

    const kinds = evidence.timeline.map((e) => e.kind);
    expect(kinds).toContain('console');
    expect(kinds).toContain('request');
    expect(kinds).toContain('marker');
    // Everything is in time order, which is what makes it readable.
    const offsets = evidence.timeline.map((e) => e.offsetMs);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it('indexes each frame row back to the attached frame it shows', () => {
    const evidence = buildEvidence(input({ frames: frames(6), select: { maxFrames: 3 } }));
    const frameRows = evidence.timeline.filter((e) => e.kind === 'frame');
    expect(frameRows.map((e) => e.frameIndex)).toEqual([0, 1, 2]);
    for (const row of frameRows) {
      expect(evidence.frames[row.frameIndex as number].offsetMs).toBe(row.offsetMs);
    }
  });

  it('bounds the total attached bytes', () => {
    const evidence = buildEvidence(
      input({
        frames: frames(200, 50, 100_000),
        console: [{ type: 'error', text: 'boom', timestamp: START + 5000 }],
        select: { maxFrames: 12, maxBytes: 500_000 },
      }),
    );
    expect(evidence.totalBytes).toBeLessThanOrEqual(500_000);
    expect(evidence.droppedFrames).toBeGreaterThan(0);
    expect(evidence.notes.join(' ')).toMatch(/not attached/);
  });

  it('trims a noisy timeline worst-first so the real error survives', () => {
    const warnings = Array.from({ length: 200 }, (_, i) => ({
      type: 'warn',
      text: `deprecation ${i}`,
      timestamp: START + i,
    }));
    const evidence = buildEvidence(
      input({
        frames: frames(4),
        console: [...warnings, { type: 'error', text: 'the real one', timestamp: START + 9999 }],
        maxEvents: 10,
        select: { maxFrames: 4 },
      }),
    );
    const details = evidence.timeline.map((e) => e.detail ?? '');
    expect(details).toContain('the real one');
    expect(evidence.timeline.filter((e) => e.kind !== 'frame').length).toBe(10);
    expect(evidence.notes.join(' ')).toMatch(/Timeline trimmed/);
  });

  it('explains itself when the breach has no single moment', () => {
    const evidence = buildEvidence(
      input({ failures: [{ budget: 'lcpMs', expected: '<= 2500ms', actual: '4100ms' }] }),
    );
    expect(evidence.focusOffsetMs).toBeNull();
    expect(evidence.notes.join(' ')).toMatch(/load-wide metric/);
  });

  it('says so plainly when nothing was recorded', () => {
    const evidence = buildEvidence(input({ frames: [] }));
    expect(evidence.frames).toEqual([]);
    expect(evidence.notes.join(' ')).toMatch(/No screencast frames/);
  });

  it('carries the dropped-frame count from the recorder into the total', () => {
    const evidence = buildEvidence(
      input({ frames: frames(4), bufferDropped: 30, select: { maxFrames: 4 } }),
    );
    expect(evidence.droppedFrames).toBe(30);
  });
});

describe('startEvidenceRecorder', () => {
  function stubClient() {
    const handlers = new Map<string, (params: unknown, sid: string) => void>();
    const send = vi.fn(async () => ({}));
    const client = {
      send,
      on: (event: string, handler: (params: unknown, sid: string) => void) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      },
    } as unknown as CdpClient;
    return { client, handlers, send };
  }

  it('starts a screencast and collects timestamped frames', async () => {
    const { client, handlers, send } = stubClient();
    const recorder = await startEvidenceRecorder(client, 'S1', Date.now());
    expect(send).toHaveBeenCalledWith('Page.startScreencast', expect.anything(), 'S1');

    handlers.get('Page.screencastFrame')?.({ data: 'abc', sessionId: 1 }, 'S1');
    expect(recorder.frames.length).toBe(1);
    expect(recorder.frames[0].bytes).toBe(3);
    // Failing to ack stalls the screencast, so it must happen every frame.
    expect(send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 1 }, 'S1');
  });

  it('ignores frames from another session', async () => {
    const { client, handlers } = stubClient();
    const recorder = await startEvidenceRecorder(client, 'S1', Date.now());
    handlers.get('Page.screencastFrame')?.({ data: 'abc', sessionId: 1 }, 'S2');
    expect(recorder.frames.length).toBe(0);
  });

  it('decimates rather than dropping the head, so early frames survive a long run', async () => {
    const { client, handlers } = stubClient();
    const recorder = await startEvidenceRecorder(client, 'S1', Date.now(), { maxFrames: 8 });
    const frame = handlers.get('Page.screencastFrame');
    for (let i = 0; i < 20; i++) frame?.({ data: `f${i}`, sessionId: i }, 'S1');

    expect(recorder.frames.length).toBeLessThanOrEqual(8);
    expect(recorder.droppedFrames).toBeGreaterThan(0);
    // The very first frame is still there — a ring buffer would have lost it.
    expect(recorder.frames[0].data).toBe('f0');
  });

  it('unsubscribes and stops the screencast on stop', async () => {
    const { client, handlers, send } = stubClient();
    const recorder = await startEvidenceRecorder(client, 'S1', Date.now());
    await recorder.stop();
    expect(send).toHaveBeenCalledWith('Page.stopScreencast', {}, 'S1');
    handlers.get('Page.screencastFrame')?.({ data: 'abc', sessionId: 1 }, 'S1');
    expect(recorder.frames.length).toBe(0);
  });
});
