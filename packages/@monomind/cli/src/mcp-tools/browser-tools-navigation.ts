/**
 * Browser MCP Tools — Navigation & Snapshot
 *
 * Split out of browser-tools.ts to keep files under 500 lines (pure move).
 */

import {
  browserSessions,
  fail,
  getConnection,
  MAX_BROWSER_SESSIONS,
  ok,
  pruneExpiredSessions,
  rejectFlagLike,
  releaseConnection,
  touchSession,
  validateScreenshotPath,
  validateSessionId,
  validateUrl,
} from './browser-session.js';
import type { MCPTool } from './types.js';

export const browserNavigationTools: MCPTool[] = [
  // ==========================================================================
  // Navigation Tools
  // ==========================================================================
  {
    name: 'browser_open',
    description:
      'Navigate browser to a URL via Chrome CDP (port set by MONOBROWSE_CDP_PORT, default 9422). Chrome must already be running with --remote-debugging-port.',
    category: 'browser',
    tags: ['navigation', 'web'],
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to (http/https/about only)' },
        session: { type: 'string', description: 'Session ID (default: "default")' },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'Wait condition after navigation',
        },
      },
      required: ['url'],
    },
    handler: async (input) => {
      const raw = input as { url?: unknown; session?: unknown; waitUntil?: unknown };
      let url: string;
      let sessionId: string;
      try {
        url = validateUrl(raw.url);
        sessionId = validateSessionId(raw.session);
      } catch (e) {
        return fail((e as Error).message);
      }

      await pruneExpiredSessions();
      if (!browserSessions.has(sessionId)) {
        // Refuse new sessions when system memory is critical
        try {
          const os = await import('node:os');
          const freeRatio = os.freemem() / os.totalmem();
          if (freeRatio < 0.1) {
            return fail(
              `System memory critical (${Math.round(freeRatio * 100)}% free). Close existing browser sessions first.`,
            );
          }
        } catch {
          /* non-critical */
        }
        if (browserSessions.size >= MAX_BROWSER_SESSIONS) {
          const oldest = [...browserSessions.entries()].sort((a, b) =>
            a[1].lastActivity.localeCompare(b[1].lastActivity),
          )[0];
          if (oldest) await releaseConnection(oldest[0]);
        }
        browserSessions.set(sessionId, {
          sessionId,
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
        });
      }

      try {
        const { openUrl, waitForLoad, getCurrentUrl, getCurrentTitle } = await import(
          '@monoes/monobrowse'
        );
        const conn = await getConnection(sessionId);
        await openUrl(conn.client, conn.cdpSessionId, url);
        const condition =
          (raw.waitUntil as 'load' | 'networkidle' | 'domcontentloaded' | undefined) ?? 'load';
        await waitForLoad(conn.client, conn.cdpSessionId, condition, 30000);
        touchSession(sessionId);
        return ok({
          url: await getCurrentUrl(conn.client, conn.cdpSessionId),
          title: await getCurrentTitle(conn.client, conn.cdpSessionId),
          session: sessionId,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },

  {
    name: 'browser_back',
    description: 'Navigate back in browser history',
    category: 'browser',
    tags: ['navigation'],
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: 'Session ID' } },
    },
    handler: async (input) => {
      const { session } = input as { session?: unknown };
      let sessionId: string;
      try {
        sessionId = validateSessionId(session);
      } catch (e) {
        return fail((e as Error).message);
      }
      try {
        const conn = await getConnection(sessionId);
        await conn.client.send('Page.goBack', {}, conn.cdpSessionId);
        touchSession(sessionId);
        return ok();
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },

  {
    name: 'browser_forward',
    description: 'Navigate forward in browser history',
    category: 'browser',
    tags: ['navigation'],
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: 'Session ID' } },
    },
    handler: async (input) => {
      const { session } = input as { session?: unknown };
      let sessionId: string;
      try {
        sessionId = validateSessionId(session);
      } catch (e) {
        return fail((e as Error).message);
      }
      try {
        const conn = await getConnection(sessionId);
        await conn.client.send('Page.goForward', {}, conn.cdpSessionId);
        touchSession(sessionId);
        return ok();
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },

  {
    name: 'browser_reload',
    description: 'Reload the current page',
    category: 'browser',
    tags: ['navigation'],
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: 'Session ID' } },
    },
    handler: async (input) => {
      const { session } = input as { session?: unknown };
      let sessionId: string;
      try {
        sessionId = validateSessionId(session);
      } catch (e) {
        return fail((e as Error).message);
      }
      try {
        const conn = await getConnection(sessionId);
        await conn.client.send('Page.reload', {}, conn.cdpSessionId);
        touchSession(sessionId);
        return ok();
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },

  {
    name: 'browser_close',
    description: 'Close the browser session (releases CDP connection)',
    category: 'browser',
    tags: ['navigation'],
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: 'Session ID' } },
    },
    handler: async (input) => {
      const { session } = input as { session?: unknown };
      let sessionId: string;
      try {
        sessionId = validateSessionId(session);
      } catch (e) {
        return fail((e as Error).message);
      }
      await releaseConnection(sessionId);
      return ok({ session: sessionId });
    },
  },

  // ==========================================================================
  // Snapshot Tools (AI-Optimized)
  // ==========================================================================
  {
    name: 'browser_snapshot',
    description:
      'Get accessibility tree snapshot of the current page. Use element roles, names, and text from the output to target elements in subsequent interaction tools.',
    category: 'browser',
    tags: ['snapshot', 'ai'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        interactive: { type: 'boolean', description: 'Only include interactive elements' },
        compact: { type: 'boolean', description: 'Remove empty structural elements' },
        depth: { type: 'number', description: 'Limit tree depth' },
        selector: { type: 'string', description: 'Scope snapshot to CSS selector' },
      },
    },
    handler: async (input) => {
      const raw = input as {
        session?: unknown;
        interactive?: boolean;
        compact?: boolean;
        depth?: number;
        selector?: unknown;
      };
      let sessionId: string;
      try {
        sessionId = validateSessionId(raw.session);
      } catch (e) {
        return fail((e as Error).message);
      }
      try {
        const { captureSnapshot } = await import('@monoes/monobrowse');
        const conn = await getConnection(sessionId);
        let safeSel: string | undefined;
        if (raw.selector !== undefined) safeSel = rejectFlagLike(raw.selector, 'selector');
        const result = await captureSnapshot(conn.client, conn.cdpSessionId, {
          selector: safeSel,
          interactiveOnly: raw.interactive ?? false,
          compact: raw.compact ?? true,
          maxDepth: raw.depth,
        });
        touchSession(sessionId);
        return ok({ snapshot: result });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },

  {
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the current page',
    category: 'browser',
    tags: ['snapshot', 'screenshot'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        path: {
          type: 'string',
          description: 'Save path within .monomind/screenshots/ (returns dataUrl if omitted)',
        },
        fullPage: { type: 'boolean', description: 'Capture full scrollable page' },
      },
    },
    handler: async (input) => {
      const raw = input as { session?: unknown; path?: unknown; fullPage?: unknown };
      let sessionId: string;
      let safePath: string | undefined;
      try {
        sessionId = validateSessionId(raw.session);
        if (raw.path !== undefined) safePath = await validateScreenshotPath(raw.path);
      } catch (e) {
        return fail((e as Error).message);
      }
      try {
        const { captureScreenshot } = await import('@monoes/monobrowse');
        const conn = await getConnection(sessionId);
        const { path: savedPath, dataUrl } = await captureScreenshot(
          conn.client,
          conn.cdpSessionId,
          {
            path: safePath,
            fullPage: raw.fullPage === true,
            format: 'png',
          },
        );
        touchSession(sessionId);
        return ok(safePath ? { path: savedPath } : { dataUrl });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  },
];

export default browserNavigationTools;
