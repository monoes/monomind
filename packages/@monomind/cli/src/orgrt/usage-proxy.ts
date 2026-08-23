// packages/@monomind/cli/src/orgrt/usage-proxy.ts
/**
 * UsageProxyServer — a loopback HTTP reverse proxy that sits between a
 * subprocess CLI and its configured LLM API base URL, purely to observe
 * token usage. It is NOT part of the request/response path functionally —
 * every request/response is relayed byte-for-byte unchanged; usage parsing
 * is a side-channel that never affects what the CLI sees.
 *
 * Why this exists: some subprocess-backed AgentRunners (CrushAgentRunner,
 * CopilotAgentRunner) drive CLIs whose non-interactive output doesn't
 * self-report token usage the way codex/kimi/qwen/grok's JSON event streams
 * do. Those CLIs DO support pointing at a custom OpenAI-compatible (or
 * Anthropic-compatible) base URL for BYOK/self-hosted use — this proxy uses
 * that existing knob rather than needing any CLI-side cooperation: the
 * runner starts a UsageProxyServer pointed at the real upstream, sets the
 * CLI's base-url env var to `proxy.url()`, and reads `proxy.totals()` after
 * each turn.
 *
 * Deliberately generic — not tied to crush/copilot specifically. Any future
 * subprocess runner whose CLI doesn't self-report usage can reuse this.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
}

export type UsageApiStyle = 'openai' | 'anthropic';

export interface UsageProxyOptions {
  /** The real API base URL requests are relayed to, e.g. https://api.openai.com. */
  upstreamBaseUrl: string;
  /** Which response-body shape to look for usage in. */
  apiStyle: UsageApiStyle;
}

/** Extract usage tokens from a single parsed JSON body (a plain
 *  chat-completion response, or one SSE `data:` chunk). Returns undefined
 *  when the body has no usage field — callers accumulate across chunks.
 *
 *  Anthropic-specific: input_tokens arrives on the `message_start` SSE event
 *  under `message.usage` (NOT top-level `usage`), while output_tokens
 *  arrives on later `message_delta` events under top-level `usage` — the two
 *  fields legitimately arrive in DIFFERENT chunks of the same stream. Fields
 *  are OPTIONAL in the return value (omitted, not defaulted to 0) precisely
 *  so the caller can merge per-field across chunks instead of the last
 *  chunk's presence/absence clobbering an earlier chunk's value — a body
 *  shape returning always-present-defaulted-to-0 fields made that merge
 *  impossible to do correctly upstream. */
function extractUsageFromBody(
  body: unknown,
  apiStyle: UsageApiStyle,
): Partial<UsageTotals> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const topUsage = record.usage;
  const nestedMessageUsage =
    apiStyle === 'anthropic' && record.message && typeof record.message === 'object'
      ? (record.message as Record<string, unknown>).usage
      : undefined;

  if (apiStyle === 'anthropic') {
    const topU =
      topUsage && typeof topUsage === 'object' ? (topUsage as Record<string, unknown>) : undefined;
    const nestedU =
      nestedMessageUsage && typeof nestedMessageUsage === 'object'
        ? (nestedMessageUsage as Record<string, unknown>)
        : undefined;
    if (!topU && !nestedU) return undefined;
    const input = nestedU?.input_tokens ?? topU?.input_tokens;
    const output = topU?.output_tokens ?? nestedU?.output_tokens;
    const result: Partial<UsageTotals> = {};
    if (typeof input === 'number') result.inputTokens = input;
    if (typeof output === 'number') result.outputTokens = output;
    return result.inputTokens !== undefined || result.outputTokens !== undefined
      ? result
      : undefined;
  }

  // openai style
  if (!topUsage || typeof topUsage !== 'object') return undefined;
  const u = topUsage as Record<string, unknown>;
  const result: Partial<UsageTotals> = {};
  if (typeof u.prompt_tokens === 'number') result.inputTokens = u.prompt_tokens;
  if (typeof u.completion_tokens === 'number') result.outputTokens = u.completion_tokens;
  return result.inputTokens !== undefined || result.outputTokens !== undefined ? result : undefined;
}

/** Merge a newly-seen partial usage reading into an accumulator, per field —
 *  a later chunk that doesn't report a field must not erase an earlier
 *  chunk's value for that field (see extractUsageFromBody's header). */
function mergeUsage(acc: Partial<UsageTotals>, next: Partial<UsageTotals>): void {
  if (next.inputTokens !== undefined) acc.inputTokens = next.inputTokens;
  if (next.outputTokens !== undefined) acc.outputTokens = next.outputTokens;
}

/** Parse a (possibly SSE) response body buffer for the usage it carries,
 *  merging per-field across every JSON document / SSE chunk found (not
 *  "last chunk wins" as a whole object — see mergeUsage). Handles both a
 *  single JSON document and `data: {...}\n\n` SSE framing. Exported for unit
 *  testing without spinning up a real server. */
export function parseUsageFromResponseBody(
  body: string,
  apiStyle: UsageApiStyle,
): UsageTotals | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  const merged: Partial<UsageTotals> = {};

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const u = extractUsageFromBody(item, apiStyle);
          if (u) mergeUsage(merged, u);
        }
      } else {
        const u = extractUsageFromBody(parsed, apiStyle);
        if (u) mergeUsage(merged, u);
      }
    } catch {
      return undefined;
    }
    return merged.inputTokens !== undefined || merged.outputTokens !== undefined
      ? { inputTokens: merged.inputTokens ?? 0, outputTokens: merged.outputTokens ?? 0 }
      : undefined;
  }

  // SSE framing: scan every `data: ` line, merging per field across chunks.
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const u = extractUsageFromBody(JSON.parse(payload), apiStyle);
      if (u) mergeUsage(merged, u);
    } catch {
      // ignore malformed SSE chunk — best-effort side-channel
    }
  }
  return merged.inputTokens !== undefined || merged.outputTokens !== undefined
    ? { inputTokens: merged.inputTokens ?? 0, outputTokens: merged.outputTokens ?? 0 }
    : undefined;
}

export class UsageProxyServer {
  private server: Server | undefined;
  private boundPort = 0;
  private totalsAcc: UsageTotals = { inputTokens: 0, outputTokens: 0 };
  private readonly upstream: URL;

  constructor(private opts: UsageProxyOptions) {
    this.upstream = new URL(opts.upstreamBaseUrl);
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createHttpServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = this.server.address();
    this.boundPort = typeof addr === 'object' && addr ? addr.port : 0;
  }

  url(): string {
    return `http://127.0.0.1:${this.boundPort}`;
  }

  totals(): UsageTotals {
    return { ...this.totalsAcc };
  }

  reset(): void {
    this.totalsAcc = { inputTokens: 0, outputTokens: 0 };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = undefined;
  }

  private handle(clientReq: IncomingMessage, clientRes: ServerResponse): void {
    const isHttps = this.upstream.protocol === 'https:';
    const upstreamPath = clientReq.url ?? '/';
    // Force identity encoding: parseUsageFromResponseBody reads the response
    // body as raw utf8 text. If the CLI's HTTP client sends its own
    // Accept-Encoding and the upstream honors it with a compressed (gzip)
    // response, that read silently produces garbage — JSON.parse fails,
    // usage extraction returns undefined, and accounting stays at 0 with no
    // error surfaced anywhere. Stripping it here means the upstream always
    // sends plain text, which this proxy can actually parse.
    const headers = { ...clientReq.headers, host: this.upstream.host };
    delete headers['accept-encoding'];

    const upstreamReq = (isHttps ? httpsRequest : httpRequest)(
      {
        protocol: this.upstream.protocol,
        hostname: this.upstream.hostname,
        port: this.upstream.port || (isHttps ? 443 : 80),
        path: upstreamPath,
        method: clientReq.method,
        headers,
      },
      (upstreamRes) => {
        clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        const chunks: Buffer[] = [];
        upstreamRes.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          clientRes.write(chunk);
        });
        upstreamRes.on('end', () => {
          clientRes.end();
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const usage = parseUsageFromResponseBody(body, this.opts.apiStyle);
            if (usage) {
              this.totalsAcc.inputTokens += usage.inputTokens;
              this.totalsAcc.outputTokens += usage.outputTokens;
            }
          } catch {
            // usage extraction is a side-channel — never let it break the proxied response
          }
        });
        upstreamRes.on('error', () => {
          try {
            clientRes.end();
          } catch {
            /* already closed */
          }
        });
      },
    );

    upstreamReq.on('error', () => {
      try {
        if (!clientRes.headersSent) clientRes.writeHead(502);
        clientRes.end();
      } catch {
        /* client already gone */
      }
    });

    clientReq.pipe(upstreamReq);
  }
}
