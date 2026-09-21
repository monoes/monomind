/**
 * Shared plumbing for the browser MCP tools.
 *
 * Session registry, CDP connection cache, input validation and result
 * formatting — used by both `browser-tools.ts` (navigation / interaction)
 * and the instrument tools (`browser-instrument-tools.ts`,
 * `browser-profile-tools.ts`). Lives in its own module so the tool files
 * stay readable and neither has to import the other.
 */

import type { MCPToolResult } from './types.js';

export const MAX_BROWSER_SESSIONS = 5;
export const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Tracking metadata for a single browser session. */
export interface BrowserSessionInfo {
  sessionId: string;
  createdAt: string;
  lastActivity: string;
}

export interface BrowserConnection {
  client: import('@monoes/monobrowse').CdpClient;
  cdpSessionId: string;
  refs: Map<string, import('@monoes/monobrowse').ElementRef>;
  /**
   * When this CDP connection was established. Console/network capture buffers
   * are armed at connect time and keyed by `cdpSessionId`, so this is the
   * start of the window those buffers cover — the instrument tools report it
   * so an agent knows what it is and isn't seeing.
   */
  openedAt: string;
}

// Session registry for multi-session support (sessionId → connection)
export const browserSessions = new Map<string, BrowserSessionInfo>();
export const connectionCache = new Map<string, BrowserConnection>();

export async function pruneExpiredSessions(): Promise<void> {
  const cutoff = Date.now() - SESSION_TTL_MS;
  const port = Number(process.env.MONOBROWSE_CDP_PORT ?? 9222);
  for (const [id, info] of browserSessions) {
    if (new Date(info.lastActivity).getTime() < cutoff) {
      browserSessions.delete(id);
      const conn = connectionCache.get(id);
      connectionCache.delete(id);
      if (conn) await closeTarget(conn, port);
    }
  }
}

export function touchSession(sessionId: string): void {
  const info = browserSessions.get(sessionId);
  if (info) info.lastActivity = new Date().toISOString();
}

export async function getConnection(sessionId: string): Promise<BrowserConnection> {
  if (connectionCache.has(sessionId)) {
    const conn = connectionCache.get(sessionId)!;
    try {
      // Liveness check — evict stale CDP connections
      await conn.client.send(
        'Runtime.evaluate',
        { expression: '1', returnByValue: true },
        conn.cdpSessionId,
      );
      return conn;
    } catch {
      const port = Number(process.env.MONOBROWSE_CDP_PORT ?? 9222);
      connectionCache.delete(sessionId);
      await closeTarget(conn, port);
    }
  }
  const port = Number(process.env.MONOBROWSE_CDP_PORT ?? 9222);
  const { connectToTarget } = await import('@monoes/monobrowse');
  const { client, sessionId: cdpSessionId } = await connectToTarget(port);
  const conn: BrowserConnection = {
    client,
    cdpSessionId,
    refs: new Map(),
    openedAt: new Date().toISOString(),
  };
  connectionCache.set(sessionId, conn);
  return conn;
}

export async function releaseConnection(sessionId: string): Promise<void> {
  const conn = connectionCache.get(sessionId);
  connectionCache.delete(sessionId);
  browserSessions.delete(sessionId);
  if (conn) {
    const port = Number(process.env.MONOBROWSE_CDP_PORT ?? 9222);
    // Close the actual Chrome tab — just closing the WebSocket leaves the
    // renderer process alive and consuming ~250MB+ RAM each. Awaited (not
    // fire-and-forget) so a burst of session churn can't pile up concurrent
    // in-flight closes and leak renderers when one fails silently.
    await closeTarget(conn, port);
  }
}

export async function closeTarget(conn: BrowserConnection, port: number): Promise<void> {
  try {
    // Get the target ID for this session so we can close the tab
    const result = await conn.client.send<{ targetInfo: { targetId: string } }>(
      'Target.getTargetInfo',
      {},
      conn.cdpSessionId,
    );
    const targetId = result?.targetInfo?.targetId;
    if (targetId) {
      // Close via HTTP endpoint — works even if the CDP session is stale
      await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`, {
        method: 'GET',
      });
    }
  } catch {
    /* best-effort */
  }
  try {
    conn.client.close();
  } catch {
    /* ignore */
  }
}

export function ok(data: Record<string, unknown> = {}): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...data }, null, 2) }] };
}

export function fail(message: string): MCPToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
    isError: true,
  };
}

/** Validate a session ID against a strict allowlist. */
export function validateSessionId(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'default';
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error('session: must match ^[A-Za-z0-9_-]{1,64}$');
  }
  return value;
}

/** Validate a URL against a scheme allowlist. */
export const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'about:']);

export function validateUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('url: must be a string');
  if (value.length > 4096) throw new Error('url: too long (max 4096)');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`url: not a valid URL: ${value}`);
  }
  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    throw new Error(`url: scheme "${parsed.protocol}" not allowed (only http/https/about)`);
  }
  return value;
}

/**
 * Validate a screenshot path. Resolved path must be within
 * `<projectRoot>/.monomind/screenshots` and must not already exist.
 */
export async function validateScreenshotPath(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('path: must be a non-empty string');
  if (value.startsWith('-')) throw new Error('path: must not start with "-"');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const root = path.resolve(process.cwd(), '.monomind', 'screenshots');
  await fs.promises.mkdir(root, { recursive: true });
  const resolved = path.resolve(value);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`path: must be within ${root}`);
  }
  if (fs.existsSync(resolved))
    throw new Error(`path: refuses to overwrite existing file at ${resolved}`);
  return resolved;
}

/**
 * Resolve the output path for a generated artifact (HAR, CPU profile, heap
 * snapshot, device screenshot) under `<projectRoot>/.monomind/<subdir>/`.
 * A caller-supplied path is taken relative to that directory, must stay
 * inside it, and must not already exist. With no path, `fallbackName` is
 * used. Creates the directory when missing.
 */
export async function resolveArtifactPath(
  subdir: string,
  value: unknown,
  fallbackName: string,
): Promise<string> {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const root = path.resolve(process.cwd(), '.monomind', subdir);
  await fs.promises.mkdir(root, { recursive: true });
  if (value === undefined || value === null || value === '') return path.join(root, fallbackName);
  if (typeof value !== 'string') throw new Error('path: must be a string');
  if (value.startsWith('-')) throw new Error('path: must not start with "-"');
  const resolved = path.resolve(root, value);
  if (!resolved.startsWith(root + path.sep)) throw new Error(`path: must be within ${root}`);
  if (fs.existsSync(resolved))
    throw new Error(`path: refuses to overwrite existing file at ${resolved}`);
  return resolved;
}

/** Reduce an arbitrary label to something safe to use as a file name. */
export function safeFileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

/** Reject strings starting with '-' (flag-injection defense). */
export function rejectFlagLike(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field}: must be a string`);
  if (value.startsWith('-'))
    throw new Error(`${field}: must not start with '-' (flag-injection defense)`);
  return value;
}

/**
 * Resolve an element target using monobrowse finders.
 * target: CSS selector string (e.g. "#id", ".class", "button")
 * locator: "selector" (default) | "role" | "text" | "label" | "placeholder"
 */
export async function findElement(
  conn: BrowserConnection,
  target: string,
  locator = 'selector',
): Promise<import('@monoes/monobrowse').ElementRef> {
  const { findBySelector, findByRole, findByText, findByLabel, findByPlaceholder } = await import(
    '@monoes/monobrowse'
  );

  let ref: import('@monoes/monobrowse').ElementRef | null = null;
  switch (locator) {
    case 'selector':
      ref = await findBySelector(conn.client, conn.cdpSessionId, conn.refs, target);
      break;
    case 'role':
      ref = await findByRole(conn.client, conn.cdpSessionId, conn.refs, target);
      break;
    case 'text':
      ref = await findByText(conn.client, conn.cdpSessionId, conn.refs, target);
      break;
    case 'label':
      ref = await findByLabel(conn.client, conn.cdpSessionId, conn.refs, target);
      break;
    case 'placeholder':
      ref = await findByPlaceholder(conn.client, conn.cdpSessionId, conn.refs, target);
      break;
    default:
      throw new Error(`Unknown locator "${locator}". Use: selector|role|text|label|placeholder`);
  }
  if (!ref) throw new Error(`Element not found: ${locator}="${target}"`);
  return ref;
}
