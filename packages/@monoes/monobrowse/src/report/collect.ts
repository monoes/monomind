/**
 * Drives the browser and gathers the raw material for a report.
 *
 * Resilience is the design constraint: a page with no vitals, a site that
 * never goes network-idle, a CSP that blocks our evaluate — each must
 * degrade into a note in the report, never a hang and never a crash. Every
 * collector is individually timed out and individually try/caught, and this
 * function always returns a CaptureData.
 */

import { evaluateJs } from '../browser/actions.js';
import { getCurrentTitle, getCurrentUrl, openUrl, waitForLoad } from '../browser/browser.js';
import type { CdpClient } from '../browser/cdp.js';
import {
  clearConsoleMessages,
  clearPageErrors,
  enableConsoleCapture,
  getConsoleMessages,
  getPageErrors,
  setupConsoleCapture,
} from '../browser/console-log.js';
import { emulateDevice, listDevices } from '../browser/emulation.js';
import {
  clearCapturedRequests,
  getCapturedRequests,
  startRequestCapture,
} from '../browser/network.js';
import { captureScreenshot } from '../browser/screenshot.js';
import { collectVitals } from '../browser/vitals.js';
import { waitFor } from '../browser/wait.js';
import { collectA11y } from './collect-a11y.js';
import type { EvidenceRecorder, EvidenceRecorderOptions } from './evidence.js';
import { startEvidenceRecorder } from './evidence.js';
import type { CaptureData, RequestEntry, Screenshot, VitalsData } from './types.js';
import { message, STEP_TIMEOUT_MS, sleep, withTimeout } from './util.js';

export interface CollectOptions {
  url: string;
  /** A CSS selector to wait for, or a number of milliseconds. */
  wait?: string | number;
  /** Device names from `listDevices()` to add to the screenshot matrix. */
  devices?: string[];
  vitalsWaitMs?: number;
  loadTimeoutMs?: number;
  screenshotDir?: string;
  fullPage?: boolean;
  /** Record screencast frames for the evidence timeline (RIG-11). */
  record?: boolean;
  recordOptions?: EvidenceRecorderOptions;
}

const DEFAULT_VITALS_WAIT_MS = 2500;
const DEFAULT_LOAD_TIMEOUT_MS = 20_000;
/** Cap on inlined screenshot bytes so the single HTML file stays openable. */
const MAX_INLINE_BYTES = 12 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Network failures
// ---------------------------------------------------------------------------

interface FailureRecord {
  errorText?: string;
  blockedReason?: string;
  canceled?: boolean;
}

/**
 * CDP reports request timings on a monotonic clock with an arbitrary epoch,
 * which cannot be compared with the `Date.now()` stamps on console entries.
 * Sampling both clocks on the first request we see gives an offset that puts
 * every request on the same timeline as everything else (RIG-11).
 */
function trackClockOffset(
  client: CdpClient,
  sessionId: string,
): { offset: () => number | undefined; stop: () => void } {
  let offset: number | undefined;
  const off = client.on('Network.requestWillBeSent', (params, sid) => {
    if (sid !== sessionId || offset !== undefined) return;
    const p = params as { timestamp?: number };
    if (typeof p.timestamp !== 'number') return;
    offset = Date.now() - p.timestamp * 1000;
  });
  return { offset: () => offset, stop: off };
}

/**
 * `startRequestCapture` records timings but drops `Network.loadingFailed`'s
 * errorText, so a DNS failure and a still-in-flight request look identical in
 * its output. Listen alongside it rather than editing it.
 */
function trackLoadingFailures(
  client: CdpClient,
  sessionId: string,
): { failures: Map<string, FailureRecord>; stop: () => void } {
  const failures = new Map<string, FailureRecord>();
  const off = client.on('Network.loadingFailed', (params, sid) => {
    if (sid !== sessionId) return;
    const p = params as {
      requestId?: string;
      errorText?: string;
      blockedReason?: string;
      canceled?: boolean;
    };
    if (!p.requestId) return;
    failures.set(p.requestId, {
      errorText: p.errorText,
      blockedReason: p.blockedReason,
      canceled: p.canceled,
    });
  });
  return { failures, stop: off };
}

export interface CapturedRequestLike {
  id: string;
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  startTime: number;
  endTime?: number;
  encodedSize?: number;
}

export function toRequestEntries(
  captured: CapturedRequestLike[],
  failures: Map<string, FailureRecord>,
  clockOffsetMs?: number,
): RequestEntry[] {
  return captured.map((r) => {
    const failure = failures.get(r.id);
    const httpError = r.status !== undefined && r.status >= 400;
    // A cancelled request is usually the page itself aborting a fetch on
    // navigation — noise, not a defect. A blockedReason (CSP, mixed content,
    // an ad blocker) is a real failure even though CDP also marks it cancelled.
    const hardFailure = failure !== undefined && (!failure.canceled || !!failure.blockedReason);
    const errorText = failure?.blockedReason
      ? `blocked: ${failure.blockedReason}`
      : (failure?.errorText ?? undefined);
    return {
      url: r.url,
      method: r.method,
      startedAtMs: clockOffsetMs === undefined ? undefined : r.startTime + clockOffsetMs,
      status: r.status,
      mimeType: r.mimeType,
      durationMs: r.endTime !== undefined ? Math.max(0, r.endTime - r.startTime) : undefined,
      encodedSize: r.encodedSize,
      failed: httpError || hardFailure,
      errorText: hardFailure ? errorText : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

async function measure(
  client: CdpClient,
  sessionId: string,
  fullPage: boolean,
): Promise<{ width: number; height: number }> {
  try {
    const raw = await evaluateJs(
      client,
      sessionId,
      fullPage
        ? '({width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight})'
        : '({width: window.innerWidth, height: window.innerHeight})',
    );
    const size = raw as { width?: number; height?: number } | null;
    return { width: Math.round(size?.width ?? 0), height: Math.round(size?.height ?? 0) };
  } catch {
    return { width: 0, height: 0 };
  }
}

async function takeShot(
  client: CdpClient,
  sessionId: string,
  label: string,
  fullPage: boolean,
  dir: string | undefined,
  notes: string[],
  inlineBudget: { left: number },
): Promise<Screenshot | null> {
  try {
    const slug = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const path = dir ? `${dir}/${slug}.png` : undefined;
    const shot = await withTimeout(
      captureScreenshot(client, sessionId, { fullPage, path }),
      STEP_TIMEOUT_MS,
      `screenshot (${label})`,
    );
    if (shot.dataUrl.length > inlineBudget.left) {
      notes.push(
        `Screenshot "${label}" omitted from the HTML — inlining it would blow the size budget.`,
      );
      return null;
    }
    inlineBudget.left -= shot.dataUrl.length;
    const size = await measure(client, sessionId, fullPage);
    return {
      label,
      width: size.width,
      height: size.height,
      dataUrl: shot.dataUrl,
      path: shot.path,
    };
  } catch (err) {
    notes.push(`Screenshot "${label}" failed: ${message(err)}`);
    return null;
  }
}

async function captureDeviceMatrix(
  client: CdpClient,
  sessionId: string,
  url: string,
  devices: string[],
  dir: string | undefined,
  notes: string[],
  inlineBudget: { left: number },
): Promise<Screenshot[]> {
  const known = new Set(listDevices());
  const shots: Screenshot[] = [];
  for (const device of devices) {
    if (!known.has(device)) {
      notes.push(`Unknown device "${device}" — known devices: ${[...known].join(', ')}`);
      continue;
    }
    try {
      await emulateDevice(client, sessionId, device);
      // Re-navigate: responsive layout and media queries only settle on a
      // fresh load, so resizing an already-rendered page can photograph a
      // layout the device would never actually produce.
      await openUrl(client, sessionId, url).catch(() => {});
      await waitForLoad(client, sessionId, 'domcontentloaded', 5000).catch(() => {});
      const shot = await takeShot(client, sessionId, device, false, dir, notes, inlineBudget);
      if (shot) shots.push(shot);
    } catch (err) {
      notes.push(`Device "${device}" skipped: ${message(err)}`);
    }
  }
  // Put the tab back the way we found it, so a later command in the same
  // session is not silently stuck emulating an iPhone.
  await client.send('Emulation.clearDeviceMetricsOverride', {}, sessionId).catch(() => {});
  await client
    .send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId)
    .catch(() => {});
  await client.send('Emulation.setUserAgentOverride', { userAgent: '' }, sessionId).catch(() => {});
  return shots;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function collect(
  client: CdpClient,
  sessionId: string,
  options: CollectOptions,
): Promise<CaptureData> {
  const notes: string[] = [];
  const startedAt = Date.now();
  const capturedAt = new Date().toISOString();
  const loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const fullPage = options.fullPage ?? true;

  // Capture must be armed BEFORE navigating, or the errors and requests that
  // fire during load — the interesting ones — are already gone.
  setupConsoleCapture(client, sessionId);
  await enableConsoleCapture(client, sessionId).catch(() => {});
  clearConsoleMessages(sessionId);
  clearPageErrors(sessionId);
  startRequestCapture(client, sessionId);
  clearCapturedRequests(sessionId);
  const tracker = trackLoadingFailures(client, sessionId);
  const clock = trackClockOffset(client, sessionId);

  // Armed before navigation for the same reason console capture is: the
  // frames worth having are the ones showing the page fail to load.
  let recorder: EvidenceRecorder | null = null;
  if (options.record) {
    try {
      recorder = await startEvidenceRecorder(client, sessionId, startedAt, options.recordOptions);
    } catch (err) {
      notes.push(`Screen recording unavailable: ${message(err)}`);
    }
  }

  try {
    const navigation = openUrl(client, sessionId, options.url)
      .then(() => 'ok' as const)
      .catch((err: unknown) => {
        notes.push(`Navigation reported an error: ${message(err)}`);
        return 'error' as const;
      });
    const outcome = await Promise.race([
      navigation,
      sleep(loadTimeoutMs).then(() => 'timeout' as const),
    ]);
    if (outcome === 'timeout') {
      notes.push(
        `Page never went network-idle within ${loadTimeoutMs}ms — reporting on what had loaded by then.`,
      );
      await waitForLoad(client, sessionId, 'domcontentloaded', 5000).catch(() => {});
    }

    if (options.wait !== undefined) {
      const waitMs = typeof options.wait === 'number' ? options.wait : Number(options.wait);
      try {
        if (Number.isFinite(waitMs)) {
          await sleep(waitMs);
        } else {
          await waitFor(client, sessionId, { selector: String(options.wait), timeout: 15_000 });
        }
      } catch (err) {
        notes.push(`--wait not satisfied: ${message(err)}`);
      }
    }

    let vitals: VitalsData = {};
    const vitalsWaitMs = options.vitalsWaitMs ?? DEFAULT_VITALS_WAIT_MS;
    try {
      vitals = await withTimeout(
        collectVitals(client, sessionId, vitalsWaitMs),
        vitalsWaitMs + STEP_TIMEOUT_MS,
        'web vitals',
      );
    } catch (err) {
      notes.push(`Web vitals unavailable: ${message(err)}`);
    }

    const a11y = await collectA11y(client, sessionId, notes);

    // Stop before the screenshots: a device matrix re-navigates the page
    // several times, and those frames belong to no failure worth explaining.
    if (recorder) await recorder.stop().catch(() => {});

    const finalUrl = await getCurrentUrl(client, sessionId).catch(() => options.url);
    const title = await getCurrentTitle(client, sessionId).catch(() => '');

    const consoleEntries = getConsoleMessages(sessionId);
    const pageErrors = getPageErrors(sessionId);
    const requests = toRequestEntries(
      getCapturedRequests(sessionId),
      tracker.failures,
      clock.offset(),
    );

    const inlineBudget = { left: MAX_INLINE_BYTES };
    const screenshots: Screenshot[] = [];
    const main = await takeShot(
      client,
      sessionId,
      'page',
      fullPage,
      options.screenshotDir,
      notes,
      inlineBudget,
    );
    if (main) screenshots.push(main);

    if (options.devices?.length) {
      screenshots.push(
        ...(await captureDeviceMatrix(
          client,
          sessionId,
          options.url,
          options.devices,
          options.screenshotDir,
          notes,
          inlineBudget,
        )),
      );
    }

    return {
      url: options.url,
      finalUrl,
      title,
      capturedAt,
      durationMs: Date.now() - startedAt,
      console: consoleEntries,
      pageErrors,
      requests,
      vitals,
      a11y: a11y.findings,
      structure: a11y.structure,
      screenshots,
      notes,
      recording: recorder
        ? {
            startedAtMs: startedAt,
            frames: recorder.frames,
            droppedFrames: recorder.droppedFrames,
            requested: true,
          }
        : undefined,
    };
  } finally {
    tracker.stop();
    clock.stop();
    if (recorder) await recorder.stop().catch(() => {});
  }
}
