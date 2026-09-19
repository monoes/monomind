/**
 * monoes.me MCP stdio<->HTTP proxy.
 *
 * i-066: the `monoes` entry in `.mcp.json` runs this as a stdio command
 * instead of embedding a bearer token. The Authorization header is resolved
 * per request from the existing refresh-aware `getValidMonoesToken()` — the
 * token never touches disk as part of this proxy, and refresh keeps
 * working with zero user action (an exported env var would go stale at the
 * next silent refresh and then 401 — see the plan's ADR for why that was
 * rejected).
 *
 * FAIL FAST: this process sits in Claude Code's MCP *startup* path. A hang
 * here degrades the user's entire Claude Code session, not just this
 * integration — so auth is resolved once, bounded (~2s), before the stdio
 * loop ever starts, and a startup failure exits non-zero immediately with a
 * one-line, actionable message. No retry loop, ever. A never-connected user
 * never gets this entry at all (see mcp-generator.ts / routes-monoes.mjs —
 * they only emit it when a connection already exists), so "not connected"
 * here means the connection was disconnected or corrupted out from under a
 * previously-written entry.
 *
 * NEVER LOG THE TOKEN: no message this module writes (stdout, stderr, or a
 * thrown/returned Error) may embed the resolved header or token value —
 * the repo's `redact()` does NOT cover `Authorization: Bearer <opaque>` or
 * `"accessToken": "..."` shapes (see plan). Every user-facing string below
 * is a fixed literal, never an interpolated fetch/network error, precisely
 * so a caught error object can never smuggle a header value into an Error
 * message, a crash report, or terminal scrollback.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { getValidMonoesToken } from '../ui/routes-monoes.mjs';

const AUTH_TIMEOUT_MS = 2000;
const REQUEST_TIMEOUT_MS = 15_000;
const REAUTH_HINT = 'Run `monomind ui`, then monoes.me -> Disconnect -> Connect to reconnect.';

export type AuthFailureReason = 'not_connected' | 'timeout';

export type AuthResolution =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: AuthFailureReason };

/**
 * Resolve MONOMIND_HOME the same way the dashboard server does: explicit
 * env var, else walk up from cwd looking for `.monomind/control.json`,
 * else cwd. Duplicated rather than imported from `ui/server.mjs` — that
 * module boots an entire HTTP server as an import side effect, which is
 * not safe to pull into a stdio MCP process.
 */
export function resolveMonomindHome(cwd: string = process.cwd()): string {
  if (process.env.MONOMIND_HOME) return path.resolve(process.env.MONOMIND_HOME);
  let dir = path.resolve(cwd);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.monomind', 'control.json'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(cwd);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Resolves a fresh Authorization header at request time. Never throws —
 * every failure (no connection, corrupted connection file, network
 * unreachable, refresh rejected, timeout) collapses to one of two fixed
 * reasons so the underlying error — which could theoretically carry request
 * details — never has to be inspected or surfaced by a caller.
 */
export async function resolveAuthHeader(
  monomindHome: string,
  options: { timeoutMs?: number; getToken?: (home: string) => Promise<string | null> } = {},
): Promise<AuthResolution> {
  const timeoutMs = options.timeoutMs ?? AUTH_TIMEOUT_MS;
  const getToken = /* fn */ options.getToken ?? getValidMonoesToken;
  let token: string | null;
  try {
    token = await withTimeout(getToken(monomindHome), timeoutMs);
  } catch {
    return { ok: false, reason: 'timeout' };
  }
  if (!token) return { ok: false, reason: 'not_connected' };
  return { ok: true, headers: { Authorization: `Bearer ${token}` } };
}

export function formatAuthFailureMessage(reason: AuthFailureReason): string {
  const detail =
    reason === 'timeout'
      ? 'could not reach monoes.me (or the stored connection is corrupted) within 2s'
      : 'not connected to monoes.me';
  return `monoes MCP proxy: ${detail}. ${REAUTH_HINT}`;
}

/** JSON-RPC messages carried by an SSE body (`data:` lines, events split by a blank line). */
export function parseSseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // A malformed event is skipped; the request still gets its own error below if nothing parsed.
    }
  }
  return messages;
}

/** Streamable HTTP session state shared by every request of one proxy process. */
interface McpSession {
  id?: string;
}

/**
 * Forwards one stdio message over MCP Streamable HTTP and returns the
 * messages to write back: none for a notification the server acknowledged
 * (202), otherwise the JSON body or every message in an SSE body.
 */
async function forwardMessage(
  monoesUrl: string,
  monomindHome: string,
  message: unknown,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  session: McpSession,
  getToken?: (home: string) => Promise<string | null>,
): Promise<unknown[]> {
  const rawId = (message as { id?: unknown } | null | undefined)?.id;
  const isNotification = rawId === undefined;
  const id = rawId ?? null;
  const auth = await resolveAuthHeader(monomindHome, { getToken });
  if (!auth.ok) {
    if (isNotification) return [];
    return [
      {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: formatAuthFailureMessage(auth.reason) },
      },
    ];
  }
  try {
    const res = await withTimeout(
      fetchImpl(monoesUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(session.id ? { 'Mcp-Session-Id': session.id } : {}),
          ...auth.headers,
        },
        body: JSON.stringify(message),
      }),
      timeoutMs,
    );
    const sessionId = res.headers?.get?.('mcp-session-id');
    if (sessionId) session.id = sessionId;
    if (res.status === 202 || res.status === 204) return [];
    const contentType = res.headers?.get?.('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      const messages = parseSseMessages(await withTimeout(res.text(), timeoutMs));
      if (messages.length === 0) throw new Error('empty event stream');
      return messages;
    }
    return [await res.json()];
  } catch {
    // Deliberately generic — never interpolate the caught error. Some fetch
    // implementations attach the request init (including headers) to a
    // thrown error's `cause`/message; string-building from it here would
    // risk leaking the Authorization value into stdout.
    if (isNotification) return [];
    return [
      {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32001,
          message: 'monoes MCP proxy: request to monoes.me failed or timed out.',
        },
      },
    ];
  }
}

export interface RunProxyOptions {
  cwd?: string;
  monomindHome?: string;
  monoesUrl?: string;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  getToken?: (home: string) => Promise<string | null>;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  exit?: (code: number) => void;
  fetchImpl?: typeof fetch;
}

/**
 * Entry point registered by `commands/mcp.ts`'s `monoes-proxy` subcommand.
 */
export async function runMonoesProxy(options: RunProxyOptions = {}): Promise<void> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const fetchImpl = options.fetchImpl ?? fetch;
  const monomindHome = options.monomindHome ?? resolveMonomindHome(options.cwd);
  const monoesBaseUrl = process.env.MONOMIND_MONOES_URL || 'https://monoes.me';
  const monoesUrl = options.monoesUrl ?? `${monoesBaseUrl}/api/mcp`;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  // Fail fast: resolve auth ONCE before ever starting the stdio loop, so a
  // corrupted/revoked/offline connection gets an immediate, bounded, named
  // failure instead of a hung or silently-broken MCP server blocking the
  // rest of the user's Claude Code session.
  const startupAuth = await resolveAuthHeader(monomindHome, {
    timeoutMs: options.timeoutMs,
    getToken: /* fn */ options.getToken,
  });
  if (!startupAuth.ok) {
    stderr.write(`${formatAuthFailureMessage(startupAuth.reason)}\n`);
    exit(1);
    return;
  }

  const session: McpSession = {};
  const rl = readline.createInterface({ input: stdin, terminal: false });
  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`,
      );
      return;
    }
    forwardMessage(
      monoesUrl,
      monomindHome,
      message,
      fetchImpl,
      requestTimeoutMs,
      session,
      options.getToken,
    )
      .then((responses) => {
        for (const response of responses) stdout.write(`${JSON.stringify(response)}\n`);
      })
      .catch(() => {
        // forwardMessage itself never rejects (it has its own try/catch),
        // but stdout.write can throw — e.g. EPIPE once Claude Code has
        // closed the pipe. Without this .catch, that throw becomes an
        // unhandled rejection, which terminates the whole process under
        // Node >= 15 — exactly the "one failure takes down the rest of the
        // session" outcome this proxy exists to prevent. Fixed literal
        // only; never the caught error (i-066 reviewer finding 7).
        try {
          stdout.write(
            `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32002, message: 'monoes MCP proxy: failed to write the response.' } })}\n`,
          );
        } catch {
          // stdout itself is gone — nothing more this process can do about it.
        }
      });
  });
}
