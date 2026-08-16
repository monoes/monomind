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
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
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
 *  when the body has no usage field — callers accumulate across chunks. */
function extractUsageFromBody(body: unknown, apiStyle: UsageApiStyle): UsageTotals | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const usage = (body as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  if (apiStyle === 'anthropic') {
    const input = u.input_tokens;
    const output = u.output_tokens;
    if (typeof input === 'number' || typeof output === 'number') {
      return { inputTokens: typeof input === 'number' ? input : 0, outputTokens: typeof output === 'number' ? output : 0 };
    }
    return undefined;
  }
  // openai style
  const input = u.prompt_tokens;
  const output = u.completion_tokens;
  if (typeof input === 'number' || typeof output === 'number') {
    return { inputTokens: typeof input === 'number' ? input : 0, outputTokens: typeof output === 'number' ? output : 0 };
  }
  return undefined;
}

/** Parse a (possibly SSE) response body buffer for the last usage object it
 *  carries. Handles both a single JSON document and `data: {...}\n\n` SSE
 *  framing (some providers only attach usage to the final SSE chunk).
 *  Exported for unit testing without spinning up a real server. */
export function parseUsageFromResponseBody(body: string, apiStyle: UsageApiStyle): UsageTotals | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        let last: UsageTotals | undefined;
        for (const item of parsed) {
          const u = extractUsageFromBody(item, apiStyle);
          if (u) last = u;
        }
        return last;
      }
      return extractUsageFromBody(parsed, apiStyle);
    } catch {
      return undefined;
    }
  }

  // SSE framing: scan every `data: ` line, keep the last usage found.
  let last: UsageTotals | undefined;
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const u = extractUsageFromBody(JSON.parse(payload), apiStyle);
      if (u) last = u;
    } catch {
      // ignore malformed SSE chunk — best-effort side-channel
    }
  }
  return last;
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
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
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
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  private handle(clientReq: IncomingMessage, clientRes: ServerResponse): void {
    const isHttps = this.upstream.protocol === 'https:';
    const upstreamPath = (clientReq.url ?? '/');
    const headers = { ...clientReq.headers, host: this.upstream.host };

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
        upstreamRes.on('error', () => { try { clientRes.end(); } catch { /* already closed */ } });
      },
    );

    upstreamReq.on('error', () => {
      try {
        if (!clientRes.headersSent) clientRes.writeHead(502);
        clientRes.end();
      } catch { /* client already gone */ }
    });

    clientReq.pipe(upstreamReq);
  }
}
