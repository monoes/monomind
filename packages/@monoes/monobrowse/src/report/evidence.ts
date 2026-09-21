/**
 * Recorded evidence for a bug report (RIG-11).
 *
 * When a run breaches its budget, "LCP was 4.1s" is a number; the frames
 * either side of the moment it went wrong, lined up against the console and
 * network entries from the same instant, is a bug report. This module records
 * the frames and assembles that timeline.
 *
 * Size is the hard constraint. A screencast is tens of megabytes and a report
 * is a single self-contained HTML file, so there are three separate bounds:
 * the recorder's ring buffer (what we hold in memory), the frame selection
 * (what we attach), and a byte budget applied over the selection. Nothing
 * here can produce a 200MB report.
 *
 * `startEvidenceRecorder` talks to Chrome; everything below it is pure and
 * unit-tested against fixture frames.
 */

import type { CdpClient } from '../browser/cdp.js';
import type {
  BudgetFailure,
  ConsoleEntry,
  Evidence,
  EvidenceFrame,
  PageErrorEntry,
  RawFrame,
  RequestEntry,
  TimelineEntry,
} from './types.js';

export type { RawFrame };

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface EvidenceRecorderOptions {
  /** Frames held in memory before the buffer is decimated. */
  maxFrames?: number;
  /** Base64 bytes held in memory before the buffer is decimated. */
  maxBytes?: number;
  everyNthFrame?: number;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface EvidenceRecorder {
  frames: RawFrame[];
  droppedFrames: number;
  stop: () => Promise<void>;
}

const DEFAULT_MAX_BUFFER_FRAMES = 160;
const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/**
 * Halve the temporal resolution of the buffer instead of dropping its head.
 *
 * A plain ring buffer keeps the end of the run, which is the wrong half: a
 * page that throws during load has its evidence at the start. Decimating
 * keeps coverage of the whole run and merely coarsens it, which degrades the
 * timeline gracefully however long the run turns out to be.
 */
function decimate(frames: RawFrame[]): { kept: RawFrame[]; dropped: number } {
  const kept = frames.filter((_, i) => i % 2 === 0);
  return { kept, dropped: frames.length - kept.length };
}

export async function startEvidenceRecorder(
  client: CdpClient,
  sessionId: string,
  startedAtMs: number,
  options: EvidenceRecorderOptions = {},
): Promise<EvidenceRecorder> {
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_BUFFER_FRAMES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  const recorder: EvidenceRecorder = {
    frames: [],
    droppedFrames: 0,
    stop: async () => {},
  };
  let bytes = 0;

  const off = client.on('Page.screencastFrame', (params, sid) => {
    if (sid !== sessionId) return;
    const p = params as { data?: string; sessionId?: number };
    // Ack first and unconditionally: Chrome stops sending frames until the
    // previous one is acknowledged, so a failure to ack silently ends the
    // recording.
    if (p.sessionId !== undefined) {
      void client
        .send('Page.screencastFrameAck', { sessionId: p.sessionId }, sessionId)
        .catch(() => {});
    }
    if (!p.data) return;
    recorder.frames.push({
      offsetMs: Math.max(0, Date.now() - startedAtMs),
      data: p.data,
      bytes: p.data.length,
    });
    bytes += p.data.length;
    if (recorder.frames.length > maxFrames || bytes > maxBytes) {
      const { kept, dropped } = decimate(recorder.frames);
      recorder.frames = kept;
      recorder.droppedFrames += dropped;
      bytes = kept.reduce((sum, f) => sum + f.bytes, 0);
    }
  });

  // Idempotent: collect() stops the recorder once the interesting part of the
  // run is over and again in its `finally`, and Chrome errors on stopping a
  // screencast that is already stopped.
  let stopped = false;
  recorder.stop = async () => {
    if (stopped) return;
    stopped = true;
    off();
    await client.send('Page.stopScreencast', {}, sessionId).catch(() => {});
  };

  try {
    await client.send(
      'Page.startScreencast',
      {
        format: 'jpeg',
        quality: options.quality ?? 60,
        everyNthFrame: options.everyNthFrame ?? 2,
        maxWidth: options.maxWidth ?? 900,
        maxHeight: options.maxHeight ?? 1600,
      },
      sessionId,
    );
  } catch (err) {
    off();
    throw err;
  }
  return recorder;
}

// ---------------------------------------------------------------------------
// Frame selection
// ---------------------------------------------------------------------------

export interface SelectFramesOptions {
  /** Frames to attach to the report. */
  maxFrames?: number;
  /** Total base64 bytes to attach. */
  maxBytes?: number;
  /** Half-width of the window around the focus, in ms. */
  windowMs?: number;
}

const DEFAULT_ATTACH_FRAMES = 12;
const DEFAULT_ATTACH_BYTES = 6 * 1024 * 1024;
const DEFAULT_WINDOW_MS = 4000;

/**
 * Pick the frames to attach.
 *
 * With a focus offset, frames nearest it win — that is the moment being
 * explained. Without one (a vitals-only breach has no instant), the run is
 * sampled evenly so the reader still sees it load. The byte budget is applied
 * last, evicting the least relevant frame first, so the cap is never reached
 * by truncating the interesting end.
 */
export function selectFrames(
  frames: RawFrame[],
  focusOffsetMs: number | null,
  options: SelectFramesOptions = {},
): { frames: RawFrame[]; dropped: number } {
  const maxFrames = Math.max(1, options.maxFrames ?? DEFAULT_ATTACH_FRAMES);
  const maxBytes = options.maxBytes ?? DEFAULT_ATTACH_BYTES;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  if (!frames.length) return { frames: [], dropped: 0 };

  let ranked: RawFrame[];
  if (focusOffsetMs === null) {
    if (frames.length <= maxFrames) {
      ranked = [...frames];
    } else {
      const step = (frames.length - 1) / (maxFrames - 1 || 1);
      const picked = new Set<number>();
      for (let i = 0; i < maxFrames; i++) picked.add(Math.round(i * step));
      ranked = [...picked].sort((a, b) => a - b).map((i) => frames[i]);
    }
  } else {
    const distance = (f: RawFrame) => Math.abs(f.offsetMs - focusOffsetMs);
    const inWindow = frames.filter((f) => distance(f) <= windowMs);
    // Fall back to the nearest frames overall rather than attaching none: a
    // failure whose frames all fell outside the window still deserves context.
    const pool = inWindow.length ? inWindow : [...frames];
    ranked = [...pool].sort((a, b) => distance(a) - distance(b)).slice(0, maxFrames);
  }

  let dropped = frames.length - ranked.length;
  let total = ranked.reduce((sum, f) => sum + f.bytes, 0);
  if (total > maxBytes) {
    const order =
      focusOffsetMs === null
        ? [...ranked]
        : [...ranked].sort(
            (a, b) => Math.abs(a.offsetMs - focusOffsetMs) - Math.abs(b.offsetMs - focusOffsetMs),
          );
    const keep = new Set<RawFrame>();
    let used = 0;
    for (const frame of order) {
      if (used + frame.bytes > maxBytes) continue;
      keep.add(frame);
      used += frame.bytes;
    }
    dropped += ranked.length - keep.size;
    ranked = ranked.filter((f) => keep.has(f));
    total = used;
  }

  return { frames: ranked.sort((a, b) => a.offsetMs - b.offsetMs), dropped };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface BuildEvidenceInput {
  reason: Evidence['reason'];
  /** `Date.now()` at the start of the run — the zero of every offset. */
  startedAtMs: number;
  frames: RawFrame[];
  /** Frames the recorder already dropped to stay inside its buffer. */
  bufferDropped?: number;
  console: ConsoleEntry[];
  pageErrors: PageErrorEntry[];
  requests: RequestEntry[];
  failures: BudgetFailure[];
  select?: SelectFramesOptions;
  /** Cap on non-frame timeline rows. */
  maxEvents?: number;
}

const DEFAULT_MAX_EVENTS = 60;

function truncate(text: string, max = 200): string {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The instant the run went wrong: the earliest hard error we have a clock
 * reading for. Returns null when the breach has no moment attached — a slow
 * LCP is a property of the whole load, not an event.
 */
export function findFocusOffset(input: BuildEvidenceInput): number | null {
  const candidates: number[] = [];
  for (const e of input.console) {
    if (e.type === 'error' && Number.isFinite(e.timestamp)) {
      candidates.push(e.timestamp - input.startedAtMs);
    }
  }
  for (const e of input.pageErrors) {
    if (Number.isFinite(e.timestamp)) candidates.push(e.timestamp - input.startedAtMs);
  }
  for (const r of input.requests) {
    if (r.failed && r.startedAtMs !== undefined) candidates.push(r.startedAtMs - input.startedAtMs);
  }
  const usable = candidates.filter((v) => Number.isFinite(v) && v >= 0);
  return usable.length ? Math.min(...usable) : null;
}

export function buildEvidence(input: BuildEvidenceInput): Evidence {
  const notes: string[] = [];
  const focusOffsetMs = findFocusOffset(input);
  const picked = selectFrames(input.frames, focusOffsetMs, input.select);

  const frames: EvidenceFrame[] = picked.frames.map((f) => ({
    offsetMs: f.offsetMs,
    dataUrl: `data:image/jpeg;base64,${f.data}`,
    bytes: f.bytes,
  }));

  const events: TimelineEntry[] = [];
  for (const [i, frame] of picked.frames.entries()) {
    events.push({
      offsetMs: frame.offsetMs,
      kind: 'frame',
      label: 'frame',
      severity: 'info',
      frameIndex: i,
    });
  }
  for (const e of input.console) {
    if (e.type !== 'error' && e.type !== 'warn' && e.type !== 'warning') continue;
    events.push({
      offsetMs: e.timestamp - input.startedAtMs,
      kind: 'console',
      label: `console.${e.type}`,
      detail: truncate(e.text),
      severity: e.type === 'error' ? 'error' : 'warning',
    });
  }
  for (const e of input.pageErrors) {
    events.push({
      offsetMs: e.timestamp - input.startedAtMs,
      kind: 'pageerror',
      label: 'uncaught exception',
      detail: truncate(e.text),
      severity: 'error',
    });
  }
  for (const r of input.requests) {
    if (!r.failed) continue;
    if (r.startedAtMs === undefined) continue;
    events.push({
      offsetMs: r.startedAtMs - input.startedAtMs,
      kind: 'request',
      label: `${r.status ?? r.errorText ?? 'no response'} ${r.method}`,
      detail: truncate(r.url),
      severity: 'error',
    });
  }
  if (focusOffsetMs !== null) {
    events.push({
      offsetMs: focusOffsetMs,
      kind: 'marker',
      label: 'first failure',
      detail: input.failures.map((f) => `${f.budget} ${f.actual}`).join(', ') || undefined,
      severity: 'error',
    });
  }

  // Trim the non-frame rows worst-first, so a page with 400 console warnings
  // still shows its one uncaught exception.
  const frameRows = events.filter((e) => e.kind === 'frame');
  let otherRows = events.filter((e) => e.kind !== 'frame');
  const maxEvents = input.maxEvents ?? DEFAULT_MAX_EVENTS;
  if (otherRows.length > maxEvents) {
    const weight = { error: 0, warning: 1, info: 2 } as const;
    const kept = [...otherRows]
      .sort(
        (a, b) =>
          weight[a.severity] - weight[b.severity] ||
          Math.abs(a.offsetMs - (focusOffsetMs ?? 0)) - Math.abs(b.offsetMs - (focusOffsetMs ?? 0)),
      )
      .slice(0, maxEvents);
    notes.push(`Timeline trimmed to the ${maxEvents} most relevant of ${otherRows.length} events.`);
    otherRows = kept;
  }

  const timeline = [...frameRows, ...otherRows].sort(
    (a, b) => a.offsetMs - b.offsetMs || a.kind.localeCompare(b.kind),
  );

  const droppedFrames = (input.bufferDropped ?? 0) + picked.dropped;
  if (droppedFrames > 0) {
    notes.push(
      `${droppedFrames} recorded frame(s) not attached — the report keeps the ${frames.length} nearest the failure to stay inside its size budget.`,
    );
  }
  if (!frames.length && input.frames.length === 0) {
    notes.push('No screencast frames were captured for this run.');
  }
  if (focusOffsetMs === null && input.failures.length) {
    notes.push(
      'No single moment of failure could be located — the breach is a load-wide metric, so the frames sample the whole run instead.',
    );
  }

  return {
    reason: input.reason,
    focusOffsetMs,
    frames,
    timeline,
    droppedFrames,
    totalBytes: frames.reduce((sum, f) => sum + f.bytes, 0),
    notes,
  };
}
