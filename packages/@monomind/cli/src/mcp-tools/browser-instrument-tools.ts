/**
 * Browser instrument tools: console output and network / HAR capture.
 *
 * monobrowse captures all of this already — these tools are the part an MCP
 * client can reach. Output is shaped for an agent that has to decide what to
 * do next: counts first, worst offenders first, long lists capped with an
 * explicit note about what was dropped.
 *
 * Registered from `browser-tools.ts`; shared plumbing lives in
 * `browser-session.ts`, and the performance/emulation half in
 * `browser-profile-tools.ts`.
 */

import {
  fail,
  getConnection,
  ok,
  rejectFlagLike,
  resolveArtifactPath,
  touchSession,
  validateSessionId,
} from './browser-session.js';
import type { MCPTool } from './types.js';

/** Longest console message text returned before it is elided. */
const MAX_MESSAGE_CHARS = 400;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export function clampLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function elide(text: string): string {
  return text.length > MAX_MESSAGE_CHARS
    ? `${text.slice(0, MAX_MESSAGE_CHARS)}… (${text.length - MAX_MESSAGE_CHARS} more chars)`
    : text;
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

interface RawRequest {
  id?: string;
  url?: string;
  method?: string;
  status?: number;
  mimeType?: string;
  startTime?: number;
  endTime?: number;
  encodedSize?: number;
}

interface NormalizedRequest {
  url: string;
  method: string;
  status?: number;
  type: string;
  durationMs?: number;
  sizeBytes?: number;
  outcome: 'ok' | 'http-error' | 'no-response' | 'pending';
}

const EXTENSION_TYPES: Array<[RegExp, string]> = [
  [/\.(js|mjs|cjs)$/, 'script'],
  [/\.css$/, 'stylesheet'],
  [/\.(png|jpe?g|gif|svg|webp|avif|ico|bmp)$/, 'image'],
  [/\.(woff2?|ttf|otf|eot)$/, 'font'],
  [/\.(mp4|webm|ogg|mp3|wav|m4a)$/, 'media'],
  [/\.json$/, 'xhr'],
  [/\.(html?|php)$/, 'document'],
];

/** Best-effort resource type — Chrome's capture records a MIME type, not a type. */
export function resourceType(url: string, mimeType?: string): string {
  const m = (mimeType ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('font/') || m.includes('font')) return 'font';
  if (m.startsWith('video/') || m.startsWith('audio/')) return 'media';
  if (m.includes('html')) return 'document';
  if (m.includes('css')) return 'stylesheet';
  if (m.includes('javascript') || m.includes('ecmascript')) return 'script';
  if (m.includes('json') || m.includes('xml') || m.includes('x-www-form')) return 'xhr';
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* relative or data: URL — match against the raw string */
  }
  for (const [re, type] of EXTENSION_TYPES) if (re.test(pathname.toLowerCase())) return type;
  return 'other';
}

function normalizeRequest(r: RawRequest): NormalizedRequest {
  const url = r.url ?? '';
  const duration =
    r.startTime !== undefined && r.endTime !== undefined
      ? Math.max(0, Math.round(r.endTime - r.startTime))
      : undefined;
  let outcome: NormalizedRequest['outcome'];
  if (r.status === undefined) outcome = r.endTime === undefined ? 'pending' : 'no-response';
  else outcome = r.status >= 400 ? 'http-error' : 'ok';
  return {
    url,
    method: (r.method ?? 'GET').toUpperCase(),
    status: r.status,
    type: resourceType(url, r.mimeType),
    durationMs: duration,
    sizeBytes: r.encodedSize,
    outcome,
  };
}

function isFailure(r: NormalizedRequest): boolean {
  return r.outcome === 'http-error' || r.outcome === 'no-response';
}

/** Glob → RegExp, matching the semantics monobrowse uses for route patterns. */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&')
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

/**
 * Every request monobrowse holds for this CDP session: the live request
 * capture plus anything the HAR recorder has buffered, deduped by id.
 */
export async function collectRequests(cdpSessionId: string): Promise<NormalizedRequest[]> {
  const { getCapturedRequests, getRequests } = await import('@monoes/monobrowse');
  const byKey = new Map<string, RawRequest>();
  for (const r of getRequests(cdpSessionId) as RawRequest[])
    byKey.set(r.id ?? `${r.method}|${r.url}`, r);
  for (const r of getCapturedRequests(cdpSessionId) as RawRequest[])
    byKey.set(r.id ?? `${r.method}|${r.url}`, r);
  return [...byKey.values()].map(normalizeRequest);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const browserInstrumentTools: MCPTool[] = [
  {
    name: 'browser_console',
    description:
      'Read console output and uncaught page errors for a browser session — reach for this FIRST when a page misbehaves, before screenshotting or guessing. Capture is armed when the session connects (browser_open), so errors thrown during page load are included. Errors are listed before warnings before logs; filter with level, cap with limit, or clear the buffer to isolate the next interaction.',
    category: 'browser',
    tags: ['console', 'errors', 'debug'],
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['error', 'warning', 'all'],
          description:
            'error = errors only; warning = warnings and errors; all = everything (default)',
        },
        limit: { type: 'number', description: `Max messages to return (default ${DEFAULT_LIMIT})` },
        clear: {
          type: 'boolean',
          description: 'Clear the buffers after reporting, so the next call shows only new output',
        },
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const raw = input as { level?: unknown; limit?: unknown; clear?: unknown; session?: unknown };
      let sessionId: string;
      try {
        sessionId = validateSessionId(raw.session);
      } catch (e) {
        return fail((e as Error).message);
      }
      const level = typeof raw.level === 'string' ? raw.level : 'all';
      if (!['error', 'warning', 'all'].includes(level))
        return fail('level: must be one of error|warning|all');
      const limit = clampLimit(raw.limit);

      try {
        const {
          enableConsoleCapture,
          getConsoleMessages,
          getPageErrors,
          clearConsoleMessages,
          clearPageErrors,
        } = await import('@monoes/monobrowse');
        const conn = await getConnection(sessionId);
        // Idempotent: re-assert the domains in case the target dropped them.
        // Never calls setupConsoleCapture — that resets the buffer, which
        // would throw away exactly the load-time errors we are here for.
        try {
          await enableConsoleCapture(conn.client, conn.cdpSessionId);
        } catch {
          /* best-effort */
        }

        const messages = getConsoleMessages(conn.cdpSessionId) as Array<{
          type: string;
          text: string;
          timestamp: number;
          url?: string;
          lineNumber?: number;
        }>;
        const pageErrors = getPageErrors(conn.cdpSessionId) as Array<{
          text: string;
          url?: string;
          lineNumber?: number;
          timestamp: number;
        }>;

        const counts = {
          error: messages.filter((m) => m.type === 'error').length,
          warning: messages.filter((m) => m.type === 'warn').length,
          other: messages.filter((m) => m.type !== 'error' && m.type !== 'warn').length,
          pageErrors: pageErrors.length,
          total: messages.length + pageErrors.length,
        };

        const allowed =
          level === 'error'
            ? new Set(['error'])
            : level === 'warning'
              ? new Set(['error', 'warn'])
              : null;
        const filtered = allowed ? messages.filter((m) => allowed.has(m.type)) : messages;

        const severity = (t: string) => (t === 'error' ? 0 : t === 'warn' ? 1 : 2);
        const ordered = [...filtered].sort(
          (a, b) => severity(a.type) - severity(b.type) || a.timestamp - b.timestamp,
        );
        const shown = ordered.slice(0, limit);

        if (raw.clear === true) {
          clearConsoleMessages(conn.cdpSessionId);
          clearPageErrors(conn.cdpSessionId);
        }
        touchSession(sessionId);

        return ok({
          session: sessionId,
          // Buffers are armed when the CDP connection opens and keyed to it,
          // so this is the true start of the window the output covers.
          capturedSince: conn.openedAt,
          counts,
          pageErrors: pageErrors.slice(0, limit).map((e) => ({
            text: elide(e.text),
            url: e.url,
            line: e.lineNumber,
          })),
          messages: shown.map((m) => ({
            type: m.type,
            text: elide(m.text),
            url: m.url,
            line: m.lineNumber,
          })),
          truncated: ordered.length - shown.length,
          cleared: raw.clear === true,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },

  {
    name: 'browser_network',
    description:
      'Inspect the network traffic of a browser session: method, URL, status, type, duration and size, failures first. Call with action:"start" before the page load you care about (capture is off until then), then reload and list. Use failedOnly to see just broken requests, or action:"har" to write a .har file for a full trace. Reach for this when a page loads blank, data is missing, or something is slow.',
    category: 'browser',
    tags: ['network', 'har', 'debug'],
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'list', 'stop', 'har'],
          description:
            'start = begin capturing; list = report what was captured (default); stop = stop capturing; har = write a .har file and stop',
        },
        failedOnly: {
          type: 'boolean',
          description: 'Only requests that failed (status >= 400 or no response)',
        },
        method: { type: 'string', description: 'Filter by HTTP method (GET, POST, …)' },
        type: {
          type: 'string',
          description:
            'Filter by resource type: document|script|stylesheet|image|font|xhr|media|other',
        },
        url: {
          type: 'string',
          description: 'Filter by URL glob, e.g. "https://api.example.com/**"',
        },
        limit: { type: 'number', description: `Max requests to return (default ${DEFAULT_LIMIT})` },
        path: {
          type: 'string',
          description: 'HAR output file, relative to .monomind/network/ (action:"har" only)',
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
      const action = typeof raw.action === 'string' ? raw.action : 'list';
      if (!['start', 'list', 'stop', 'har'].includes(action))
        return fail('action: must be one of start|list|stop|har');
      const limit = clampLimit(raw.limit);

      try {
        const {
          startRequestCapture,
          stopRequestCapture,
          startHarRecording,
          stopHarRecording,
          getHarStatus,
          getRequests,
        } = await import('@monoes/monobrowse');
        const conn = await getConnection(sessionId);
        const sid = conn.cdpSessionId;
        touchSession(sessionId);

        if (action === 'start') {
          startRequestCapture(conn.client, sid);
          // HAR recording rides along so action:"har" can export later without
          // a second arming step; both are stopped together.
          try {
            await startHarRecording(conn.client, sid);
          } catch (e) {
            if (!/already in progress/i.test((e as Error).message)) throw e;
          }
          return ok({
            session: sessionId,
            recording: true,
            note: 'Capture is live. Reload the page (browser_reload) so its requests are recorded, then call browser_network again.',
          });
        }

        if (action === 'stop' || action === 'har') {
          const harActive = getHarStatus(sid).recording;
          if (action === 'har' && !harActive) {
            return fail(
              'No HAR recording for this session. Call browser_network with action:"start", reload the page, then export.',
            );
          }
          const entries = harActive ? (getRequests(sid) as RawRequest[]).length : 0;
          let harPath: string | undefined;
          if (harActive) {
            const outPath = await resolveArtifactPath(
              'network',
              raw.path,
              `session-${Date.now()}.har`,
            );
            harPath = await stopHarRecording(conn.client, sid, outPath);
          }
          stopRequestCapture(sid);
          return ok({
            session: sessionId,
            recording: false,
            path: harPath,
            entries,
            note: harPath
              ? 'HAR written; capture stopped and the in-memory request list was released. Call action:"start" again to record more.'
              : 'Capture stopped.',
          });
        }

        // action === 'list'
        const recording = getHarStatus(sid).recording;
        let requests = await collectRequests(sid);
        const total = requests.length;
        const failed = requests.filter(isFailure).length;

        const byType: Record<string, number> = {};
        for (const r of requests) byType[r.type] = (byType[r.type] ?? 0) + 1;

        if (raw.failedOnly === true) requests = requests.filter(isFailure);
        if (raw.method !== undefined) {
          const want = rejectFlagLike(raw.method, 'method').toUpperCase();
          requests = requests.filter((r) => r.method === want);
        }
        if (raw.type !== undefined) {
          const want = rejectFlagLike(raw.type, 'type').toLowerCase();
          requests = requests.filter((r) => r.type === want);
        }
        if (raw.url !== undefined) {
          const re = globToRegex(rejectFlagLike(raw.url, 'url'));
          requests = requests.filter((r) => re.test(r.url));
        }

        // Worst offenders first: failures, then the slowest.
        const ordered = [...requests].sort(
          (a, b) =>
            Number(isFailure(b)) - Number(isFailure(a)) ||
            (b.durationMs ?? 0) - (a.durationMs ?? 0),
        );
        const shown = ordered.slice(0, limit);
        const withSize = requests.filter((r) => r.sizeBytes !== undefined);

        return ok({
          session: sessionId,
          recording,
          total,
          failed,
          matched: requests.length,
          byType,
          slowest: [...requests]
            .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
            .slice(0, 3)
            .map((r) => ({ url: r.url, durationMs: r.durationMs })),
          largest: withSize
            .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
            .slice(0, 3)
            .map((r) => ({ url: r.url, sizeBytes: r.sizeBytes })),
          requests: shown,
          truncated: ordered.length - shown.length,
          note: recording
            ? undefined
            : 'Network capture is not running for this session — call browser_network with action:"start" and reload the page. An empty list here does not mean the page made no requests.',
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
];

export default browserInstrumentTools;
