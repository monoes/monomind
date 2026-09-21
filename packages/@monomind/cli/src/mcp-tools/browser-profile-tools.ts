/**
 * Browser performance tools: web vitals, CPU/heap profiling, device emulation.
 *
 * Profiles and heap snapshots are megabytes of JSON, so these tools write the
 * artifact to a file under `.monomind/` and return the path plus a summary an
 * agent can actually act on — never the raw dump.
 *
 * Registered from `browser-tools.ts`; shared plumbing lives in
 * `browser-session.ts`, console/network capture in
 * `browser-instrument-tools.ts`, and the grading/summarising in
 * `browser-metrics.ts`.
 */

import { collectRequests } from './browser-instrument-tools.js';
import { gradeVitals, summarizeCpuProfile } from './browser-metrics.js';
import {
  fail,
  getConnection,
  ok,
  rejectFlagLike,
  resolveArtifactPath,
  safeFileSlug,
  touchSession,
  validateSessionId,
} from './browser-session.js';
import type { MCPTool } from './types.js';

/** Most devices allowed in one emulation matrix run — each is a full screenshot. */
const MAX_MATRIX_DEVICES = 8;
/** Refuse to parse a .cpuprofile larger than this; the file is still written. */
const MAX_PROFILE_PARSE_BYTES = 64 * 1024 * 1024;
/** Settle time after applying a device profile before screenshotting. */
const EMULATION_SETTLE_MS = 300;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const browserProfileTools: MCPTool[] = [
  {
    name: 'browser_vitals',
    description:
      'Measure Core Web Vitals for the loaded page — LCP, CLS, INP, TTFB, FCP — graded against the standard budgets, with the metrics that miss them listed worst-first. Returns numbers to act on plus the human-readable report. Reach for this when asked whether a page is fast, or after a change that could affect load performance. Run browser_network with action:"start" and reload beforehand to also get the heaviest resources.',
    category: 'browser',
    tags: ['performance', 'vitals'],
    inputSchema: {
      type: 'object',
      properties: {
        waitMs: {
          type: 'number',
          description: 'How long to observe before reporting (default 2000, max 10000)',
        },
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const raw = input as { waitMs?: unknown; session?: unknown };
      let sessionId: string;
      try {
        sessionId = validateSessionId(raw.session);
      } catch (e) {
        return fail((e as Error).message);
      }
      const waitMs = Math.min(Math.max(Number(raw.waitMs ?? 2000), 0), 10_000);
      try {
        const { collectVitals, formatVitals } = await import('@monoes/monobrowse');
        const conn = await getConnection(sessionId);
        const vitals = await collectVitals(conn.client, conn.cdpSessionId, waitMs);
        const { assessment, worst } = gradeVitals(vitals as Record<string, number | undefined>);

        const heaviest = (await collectRequests(conn.cdpSessionId))
          .filter((r) => r.sizeBytes !== undefined)
          .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
          .slice(0, 5)
          .map((r) => ({
            url: r.url,
            type: r.type,
            sizeBytes: r.sizeBytes,
            durationMs: r.durationMs,
          }));

        touchSession(sessionId);
        return ok({
          session: sessionId,
          vitals,
          formatted: formatVitals(vitals),
          assessment,
          worst,
          heaviestResources: heaviest.length > 0 ? heaviest : undefined,
          note:
            heaviest.length > 0
              ? undefined
              : 'No resource sizes available — run browser_network with action:"start" and reload the page to attribute page weight to specific requests.',
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },

  {
    name: 'browser_profile',
    description:
      'CPU profile or heap snapshot of the page. action:"start" then interact then action:"stop" writes a .cpuprofile and returns the functions burning the most self time — enough to answer "what is slow" without reading the file. action:"heap" writes a .heapsnapshot for leak hunting. Reach for this when a page is janky or memory-hungry and browser_vitals only told you that it is.',
    category: 'browser',
    tags: ['performance', 'profiling', 'memory'],
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'stop', 'heap'],
          description: 'start/stop a CPU profile, or heap for a one-shot heap snapshot',
        },
        topFunctions: {
          type: 'number',
          description: 'How many hot functions to summarise on stop (default 10, max 50)',
        },
        samplingInterval: {
          type: 'number',
          description: 'CPU sampling interval in microseconds (default: Chrome’s 1000)',
        },
        path: {
          type: 'string',
          description: 'Output file, relative to .monomind/profiles/ (default: timestamped)',
        },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['action'],
    },
    handler: async (input) => {
      const raw = input as Record<string, unknown>;
      let sessionId: string;
      try {
        sessionId = validateSessionId(raw.session);
      } catch (e) {
        return fail((e as Error).message);
      }
      const action = raw.action;
      if (action !== 'start' && action !== 'stop' && action !== 'heap')
        return fail('action: must be one of start|stop|heap');
      const top = Math.min(Math.max(Number(raw.topFunctions ?? 10), 1), 50);

      try {
        const { startCpuProfile, stopCpuProfile, startHeapSnapshot } = await import(
          '@monoes/monobrowse'
        );
        const conn = await getConnection(sessionId);
        touchSession(sessionId);

        if (action === 'start') {
          const interval =
            raw.samplingInterval !== undefined ? Number(raw.samplingInterval) : undefined;
          if (interval !== undefined && (!Number.isFinite(interval) || interval <= 0))
            return fail('samplingInterval: must be a positive number of microseconds');
          await startCpuProfile(conn.client, conn.cdpSessionId, { samplingInterval: interval });
          return ok({
            session: sessionId,
            profiling: true,
            note: 'CPU profiler running. Drive the page, then call browser_profile with action:"stop".',
          });
        }

        const fs = await import('node:fs/promises');

        if (action === 'heap') {
          const outPath = await resolveArtifactPath(
            'profiles',
            raw.path,
            `heap-${Date.now()}.heapsnapshot`,
          );
          // A snapshot that captured no chunks throws inside startHeapSnapshot
          // rather than returning a path, so a path here always has data and
          // an empty one surfaces as fail() through the catch below.
          const written = await startHeapSnapshot(conn.client, conn.cdpSessionId, outPath);
          const { size } = await fs.stat(written);
          return ok({
            session: sessionId,
            path: written,
            sizeBytes: size,
            note: 'Heap snapshot written. Open it in Chrome DevTools → Memory → Load to compare retainers.',
          });
        }

        // action === 'stop'
        const outPath = await resolveArtifactPath(
          'profiles',
          raw.path,
          `cpu-${Date.now()}.cpuprofile`,
        );
        const written = await stopCpuProfile(conn.client, conn.cdpSessionId, outPath);
        const { size } = await fs.stat(written);
        if (size > MAX_PROFILE_PARSE_BYTES) {
          return ok({
            session: sessionId,
            path: written,
            sizeBytes: size,
            note: `Profile is ${Math.round(size / 1024 / 1024)}MB — too large to summarise here. Open it in Chrome DevTools → Performance.`,
          });
        }
        let summary: ReturnType<typeof summarizeCpuProfile>;
        try {
          summary = summarizeCpuProfile(JSON.parse(await fs.readFile(written, 'utf8')), top);
        } catch (e) {
          return ok({
            session: sessionId,
            path: written,
            sizeBytes: size,
            note: `Profile written but could not be summarised (${(e as Error).message}). Open it in Chrome DevTools → Performance.`,
          });
        }
        return ok({
          session: sessionId,
          path: written,
          sizeBytes: size,
          durationMs: summary.durationMs,
          totalSamples: summary.totalSamples,
          topFunctions: summary.topFunctions,
          note:
            summary.totalSamples === 0
              ? 'No samples recorded — the page was idle for the whole profile.'
              : 'selfMs is time sampled inside the function itself, not its callees.',
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },

  {
    name: 'browser_emulate',
    description:
      'Apply a device profile (viewport, DPR, touch, user agent) to the session, or pass devices:[…] to screenshot the current URL across a matrix of them and get the file paths back. Call with no arguments to list the available devices. Reach for this to check responsive layout or to reproduce a mobile-only bug. Emulation persists until reset:true, so clear it before other work.',
    category: 'browser',
    tags: ['emulation', 'responsive', 'screenshot'],
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description: 'Device profile name to apply (see the no-arg listing)',
        },
        devices: {
          type: 'array',
          items: { type: 'string' },
          description: `Matrix mode: screenshot the current URL on each device (max ${MAX_MATRIX_DEVICES})`,
        },
        fullPage: { type: 'boolean', description: 'Matrix mode: capture the full scrollable page' },
        reload: {
          type: 'boolean',
          description: 'Matrix mode: reload on each device instead of only reflowing',
        },
        reset: {
          type: 'boolean',
          description: 'Clear emulation overrides and restore the defaults',
        },
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const raw = input as Record<string, unknown>;
      let sessionId: string;
      try {
        sessionId = validateSessionId(raw.session);
      } catch (e) {
        return fail((e as Error).message);
      }

      const matrix = raw.devices;
      if (matrix !== undefined) {
        if (!Array.isArray(matrix) || matrix.some((d) => typeof d !== 'string'))
          return fail('devices: must be an array of device names');
        if (matrix.length === 0) return fail('devices: must not be empty');
        if (matrix.length > MAX_MATRIX_DEVICES)
          return fail(`devices: too many (max ${MAX_MATRIX_DEVICES} per run)`);
      }

      try {
        const { emulateDevice, listDevices, captureScreenshot, getCurrentUrl, waitForLoad } =
          await import('@monoes/monobrowse');

        if (raw.device === undefined && matrix === undefined && raw.reset !== true) {
          return ok({
            devices: listDevices(),
            note: 'Pass device:"<name>" to emulate one, or devices:["…","…"] to screenshot a matrix.',
          });
        }

        const conn = await getConnection(sessionId);
        touchSession(sessionId);

        if (raw.reset === true && matrix === undefined && raw.device === undefined) {
          await clearEmulation(conn);
          return ok({ session: sessionId, reset: true });
        }

        if (matrix === undefined) {
          const device = rejectFlagLike(raw.device, 'device');
          await emulateDevice(conn.client, conn.cdpSessionId, device);
          return ok({
            session: sessionId,
            device,
            note: 'Emulation stays active for this session — call browser_emulate with reset:true when done.',
          });
        }

        // Matrix mode: one screenshot per device, then put the session back.
        const url = await getCurrentUrl(conn.client, conn.cdpSessionId);
        const stamp = Date.now();
        const screenshots: Array<{ device: string; path?: string; error?: string }> = [];
        for (const device of matrix as string[]) {
          try {
            await emulateDevice(conn.client, conn.cdpSessionId, device);
            if (raw.reload === true) {
              await conn.client.send('Page.reload', {}, conn.cdpSessionId);
              await waitForLoad(conn.client, conn.cdpSessionId, 'load', 30_000);
            } else {
              await new Promise((r) => setTimeout(r, EMULATION_SETTLE_MS));
            }
            const outPath = await resolveArtifactPath(
              'screenshots',
              undefined,
              `emulate-${stamp}-${safeFileSlug(device)}.png`,
            );
            const shot = await captureScreenshot(conn.client, conn.cdpSessionId, {
              path: outPath,
              fullPage: raw.fullPage === true,
              format: 'png',
            });
            screenshots.push({ device, path: shot.path ?? outPath });
          } catch (e) {
            screenshots.push({ device, error: (e as Error).message });
          }
        }
        await clearEmulation(conn);

        const failed = screenshots.filter((s) => s.error !== undefined).length;
        return ok({
          session: sessionId,
          url,
          screenshots,
          failed,
          note: 'Emulation overrides were cleared after the matrix run.',
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
];

/** Drop every emulation override so later tool calls see a normal browser. */
async function clearEmulation(conn: {
  client: import('@monoes/monobrowse').CdpClient;
  cdpSessionId: string;
}): Promise<void> {
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    try {
      await conn.client.send(method, params, conn.cdpSessionId);
    } catch {
      /* best-effort: a cleared override that was never set is not an error */
    }
  };
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setUserAgentOverride', { userAgent: '' });
}

export default browserProfileTools;
