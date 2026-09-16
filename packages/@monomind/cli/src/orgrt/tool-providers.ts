// packages/@monomind/cli/src/orgrt/tool-providers.ts
/**
 * Role tool providers (M1, capability `org-tool-providers`).
 *
 * A role's `tool_providers[]` names stdio MCP servers whose tools the role
 * gets next to the org tools, exposed as `<prefix>__<mcpToolName>` (so on the
 * Claude runner they arrive as `mcp__org__<prefix>__<tool>`).
 *
 * Lifecycle (contract §2 M1):
 *  - tool list: fetched once per provider config (hash of command, args, env,
 *    allow) by a short-lived process — spawn, initialize, tools/list, exit —
 *    and cached for the daemon's lifetime;
 *  - calls: the provider process is spawned lazily on the first call, reused,
 *    and exits after `idle_ms` without calls; a crash is restarted once per
 *    session, after which calls return `ERROR: tool provider <name>
 *    unavailable: <reason>`;
 *  - every provider process is killed on session end and on `stopOrg`.
 *
 * The MCP client here is a deliberately small, dependency-free JSON-RPC 2.0
 * client over newline-delimited stdio (the MCP stdio transport): initialize,
 * notifications/initialized, tools/list (with pagination), tools/call.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { OrgToolDef } from './agent-runner.js';
import type { OrgBus } from './bus.js';
import type { OrgRole, ToolProviderConfig } from './types.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const LIST_TIMEOUT_MS = 30_000;
const STDERR_TAIL = 2_000;

// ── Trace ────────────────────────────────────────────────────────────────

export interface ChainTrace {
  chain_id: string;
  hop: number;
}

export interface ToolCallTrace extends ChainTrace {
  org: string;
  run: string;
  role: string;
}

const TRACE_LINE = /^\[trace (chn_[A-Za-z0-9_-]+) hop=(\d+)\]/m;

/** The `[trace chn_<id> hop=<n>]` line of a message body, if any. */
export function parseTraceLine(body: string): ChainTrace | undefined {
  const m = TRACE_LINE.exec(body);
  if (!m) return undefined;
  return { chain_id: m[1], hop: Number.parseInt(m[2], 10) };
}

/** `chn_` + 20 random [a-z0-9]. */
export function freshChainId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(20);
  let id = 'chn_';
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

// ── JSON Schema → zod ────────────────────────────────────────────────────

/** Convert one JSON Schema node to zod. Supports string, number, integer,
 *  boolean, array, object, null and enum; anything else becomes z.any(). */
export function jsonSchemaToZod(schema: unknown): z.ZodType<any> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return z.any();
  const s = schema as Record<string, unknown>;
  const describe = (t: z.ZodType<any>): z.ZodType<any> =>
    typeof s.description === 'string' && s.description ? t.describe(s.description) : t;

  if (Array.isArray(s.enum) && s.enum.length > 0) {
    const values = s.enum as unknown[];
    if (values.every((v) => typeof v === 'string'))
      return describe(z.enum(values as [string, ...string[]]));
    const literals = values
      .filter((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
      .map((v) => z.literal(v as string | number | boolean | null));
    if (literals.length === 0) return describe(z.any());
    if (literals.length === 1) return describe(literals[0]);
    return describe(z.union(literals as unknown as [z.ZodType<any>, z.ZodType<any>]));
  }

  let type = s.type;
  let nullable = false;
  if (Array.isArray(type)) {
    const types = type.filter((t) => t !== 'null');
    nullable = types.length !== type.length;
    type = types.length === 1 ? types[0] : undefined;
  }

  let out: z.ZodType<any>;
  switch (type) {
    case 'string':
      out = z.string();
      break;
    case 'number':
      out = z.number();
      break;
    case 'integer':
      out = z.number().int();
      break;
    case 'boolean':
      out = z.boolean();
      break;
    case 'null':
      out = z.null();
      break;
    case 'array':
      out = z.array(jsonSchemaToZod(s.items));
      break;
    case 'object':
      out =
        s.properties && typeof s.properties === 'object'
          ? z.object(jsonSchemaToZodShape(s)).passthrough()
          : z.record(z.string(), z.any());
      break;
    default:
      out = z.any();
  }
  if (nullable) out = out.nullable();
  return describe(out);
}

/** Convert an object JSON Schema (an MCP tool `inputSchema`) into the zod
 *  SHAPE `OrgToolDef.schema` expects; `required` is honoured. */
export function jsonSchemaToZodShape(schema: unknown): Record<string, z.ZodType<any>> {
  const shape: Record<string, z.ZodType<any>> = {};
  if (!schema || typeof schema !== 'object') return shape;
  const s = schema as { properties?: Record<string, unknown>; required?: unknown };
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
  for (const [key, prop] of Object.entries(s.properties ?? {})) {
    const t = jsonSchemaToZod(prop);
    shape[key] = required.has(key) ? t : t.optional();
  }
  return shape;
}

// ── MCP result mapping ───────────────────────────────────────────────────

/** MCP `tools/call` result → tool text: text parts joined with '\n',
 *  non-text parts as `[<type> omitted]`, `isError: true` → `ERROR: ` prefix. */
export function mapToolResult(result: unknown): string {
  const r = (result ?? {}) as { content?: unknown; isError?: unknown };
  const parts: string[] = [];
  if (Array.isArray(r.content)) {
    for (const c of r.content as Array<{ type?: unknown; text?: unknown }>) {
      if (c && c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
      else parts.push(`[${String(c?.type ?? 'unknown')} omitted]`);
    }
  }
  const text = parts.join('\n');
  return r.isError === true ? `ERROR: ${text}` : text;
}

// ── Stdio JSON-RPC client ────────────────────────────────────────────────

export class McpRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}
export class McpTimeoutError extends Error {}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpSpawnSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

/** Minimal MCP client over a child process's stdio (newline-delimited JSON). */
export class McpStdioClient {
  private child?: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf = '';
  private stderrTail = '';
  private closing = false;
  exited = false;
  exitReason?: string;
  /** Called once when the process goes away; `deliberate` = close() was called. */
  onExit?: (reason: string, deliberate: boolean) => void;

  constructor(private spec: McpSpawnSpec) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  async start(timeoutMs = LIST_TIMEOUT_MS): Promise<void> {
    let child: ChildProcess;
    try {
      child = spawn(this.spec.command, this.spec.args, {
        env: this.spec.env,
        cwd: this.spec.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.fail(`spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new Error(this.exitReason);
    }
    this.child = child;
    child.on('error', (err) => this.fail(`spawn failed: ${err.message}`));
    child.on('exit', (code, signal) => {
      const tail = this.stderrTail.trim().split('\n').slice(-3).join(' | ');
      this.fail(
        `process exited (${signal ? `signal ${signal}` : `code ${code}`})${tail ? `: ${tail}` : ''}`,
      );
    });
    child.stdin?.on('error', () => {
      /* EPIPE after exit — surfaced through the exit handler */
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.onData(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL);
    });
    await this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'monomind-org', version: '1.0.0' },
      },
      timeoutMs,
    );
    this.notify('notifications/initialized');
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.exited) return Promise.reject(new Error(this.exitReason ?? 'process not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject };
      entry.timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpTimeoutError(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      (entry.timer as { unref?: () => void }).unref?.();
      this.pending.set(id, entry);
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  }

  async listTools(timeoutMs = LIST_TIMEOUT_MS): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const res = (await this.request('tools/list', cursor ? { cursor } : {}, timeoutMs)) as {
        tools?: McpToolInfo[];
        nextCursor?: string;
      };
      for (const t of res?.tools ?? []) if (t && typeof t.name === 'string') tools.push(t);
      cursor = typeof res?.nextCursor === 'string' && res.nextCursor ? res.nextCursor : undefined;
      if (!cursor) break;
    }
    return tools;
  }

  /** Deliberate shutdown: SIGTERM, SIGKILL after 2 s. */
  close(): void {
    if (this.exited) return;
    this.closing = true;
    const child = this.child;
    try {
      child?.stdin?.end();
    } catch {
      /* already closed */
    }
    try {
      child?.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    const t = setTimeout(() => {
      try {
        if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, 2_000);
    t.unref?.();
    this.fail('closed');
  }

  private write(msg: unknown): void {
    try {
      this.child?.stdin?.write(`${JSON.stringify(msg)}\n`);
    } catch {
      /* surfaced through exit */
    }
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl = this.buf.indexOf('\n');
    while (nl !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this.onLine(line);
      nl = this.buf.indexOf('\n');
    }
  }

  private onLine(line: string): void {
    let msg: {
      id?: number | string;
      method?: string;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not JSON-RPC (stray log line) — ignore
    }
    if (msg.method !== undefined) {
      // Server → client request: answer ping, refuse the rest. Notifications ignored.
      if (msg.id !== undefined) {
        if (msg.method === 'ping') this.write({ jsonrpc: '2.0', id: msg.id, result: {} });
        else
          this.write({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32601, message: `method not supported: ${msg.method}` },
          });
      }
      return;
    }
    if (typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (p.timer) clearTimeout(p.timer);
    if (msg.error) p.reject(new McpRpcError(msg.error.message ?? 'MCP error', msg.error.code));
    else p.resolve(msg.result);
  }

  private fail(reason: string): void {
    if (this.exited) return;
    this.exited = true;
    this.exitReason = reason;
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
    this.onExit?.(reason, this.closing);
  }
}

// ── Provider config helpers ──────────────────────────────────────────────

export interface ProviderContext {
  org: string;
  run: string;
  role: string;
  /** Daemon project root. */
  root: string;
}

export function providerPrefix(p: Pick<ToolProviderConfig, 'name' | 'prefix'>): string {
  return p.prefix ?? p.name.replace(/-/g, '_');
}

/** Tool-name prefixes (`<prefix>__`) a role's providers contribute. */
export function roleProviderPrefixes(role: Pick<OrgRole, 'tool_providers'>): string[] {
  return (role.tool_providers ?? []).map((p) => `${providerPrefix(p)}__`);
}

function providerEnv(p: ToolProviderConfig, ctx: ProviderContext): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  Object.assign(env, p.env ?? {});
  env.MONOMIND_ORG_NAME = ctx.org;
  env.MONOMIND_ORG_RUN = ctx.run;
  env.MONOMIND_ORG_ROLE = ctx.role;
  env.MONOMIND_ORG_ROOT = ctx.root;
  return env;
}

function configHash(p: ToolProviderConfig): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        command: p.command,
        args: p.args ?? [],
        env: p.env ?? {},
        allow: p.allow ?? null,
      }),
    )
    .digest('hex');
}

/** Fill schema defaults for a provider entry that did not come through
 *  RoleSchema.parse (e.g. a hot-reloaded or hand-built role). */
function normalizeProvider(
  p: ToolProviderConfig,
): Required<Pick<ToolProviderConfig, 'args' | 'env' | 'timeout_ms' | 'idle_ms'>> &
  ToolProviderConfig {
  return {
    ...p,
    args: p.args ?? [],
    env: p.env ?? {},
    timeout_ms: p.timeout_ms ?? 660_000,
    idle_ms: p.idle_ms ?? 300_000,
  };
}

// ── Per-session provider process ─────────────────────────────────────────

/** One provider's call-side process for one role session. */
class ProviderProcess {
  private client?: McpStdioClient;
  private starting?: Promise<McpStdioClient>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private inflight = 0;
  private crashes = 0;
  private lastCrash = '';
  private closed = false;

  constructor(
    readonly cfg: ReturnType<typeof normalizeProvider>,
    private ctx: ProviderContext,
    private cwd: string | undefined,
    private bus?: OrgBus,
  ) {}

  get pid(): number | undefined {
    return this.client && !this.client.exited ? this.client.pid : undefined;
  }

  private unavailable(reason: string): string {
    return `ERROR: tool provider ${this.cfg.name} unavailable: ${reason}`;
  }

  private ensure(): Promise<McpStdioClient> {
    if (this.client && !this.client.exited) return Promise.resolve(this.client);
    if (this.starting) return this.starting;
    // Restart once per session after a crash; a second crash is final.
    if (this.crashes >= 2) return Promise.reject(new Error(this.lastCrash));
    const client = new McpStdioClient({
      command: this.cfg.command,
      args: this.cfg.args,
      env: providerEnv(this.cfg, this.ctx),
      cwd: this.cwd,
    });
    let counted = false;
    client.onExit = (reason, deliberate) => {
      if (this.client === client) this.client = undefined;
      if (deliberate) return;
      counted = true;
      this.crashes++;
      this.lastCrash = reason;
      this.bus?.emit({
        type: 'audit',
        from: this.ctx.role,
        reason: 'tool-provider-crashed',
        msg: `tool provider ${this.cfg.name} ${reason}${this.crashes >= 2 ? ' — not restarting again this session' : ' — restarting on next call'}`,
        data: { provider: this.cfg.name, crashes: this.crashes },
      });
    };
    this.starting = client
      .start()
      .then(() => {
        this.client = client;
        return client;
      })
      .catch((err: Error) => {
        client.close();
        // A start failure that did not surface as a process exit (e.g. an
        // initialize timeout) still counts against the restart budget.
        if (!counted) {
          this.crashes++;
          this.lastCrash = err.message;
        }
        throw err;
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }

  async call(tool: string, args: Record<string, unknown>, trace: ToolCallTrace): Promise<string> {
    if (this.closed) return this.unavailable('session ended');
    let client: McpStdioClient;
    try {
      client = await this.ensure();
    } catch (err) {
      return this.unavailable(err instanceof Error ? err.message : String(err));
    }
    this.inflight++;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    try {
      const res = await client.request(
        'tools/call',
        { name: tool, arguments: args ?? {}, _meta: { trace } },
        this.cfg.timeout_ms,
      );
      return mapToolResult(res);
    } catch (err) {
      if (err instanceof McpRpcError) return `ERROR: ${err.message}`;
      if (err instanceof McpTimeoutError)
        return `ERROR: tool provider ${this.cfg.name}: ${tool} ${err.message}`;
      return this.unavailable(err instanceof Error ? err.message : String(err));
    } finally {
      this.inflight--;
      this.armIdle();
    }
  }

  private armIdle(): void {
    if (this.closed || this.inflight > 0) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.inflight === 0) this.client?.close();
    }, this.cfg.idle_ms);
    this.idleTimer.unref?.();
  }

  close(): void {
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.client?.close();
    this.client = undefined;
  }
}

export interface RoleProviderToolSet {
  tools: OrgToolDef[];
  /** Kill every provider process this session started. Idempotent. */
  close(): void;
  /** Live provider pids by provider name (tests / diagnostics). */
  pids(): Record<string, number | undefined>;
}

/** Daemon-lifetime owner of provider tool-list caches and live processes. */
export class ToolProviderHub {
  private listCache = new Map<string, Promise<McpToolInfo[]>>();
  private sessions = new Map<string, Set<RoleProviderToolSet>>();

  /** tools/list for one provider config — cached per config hash. A failed
   *  listing is evicted so the next session start retries it. */
  listTools(p: ToolProviderConfig, ctx: ProviderContext, cwd?: string): Promise<McpToolInfo[]> {
    const cfg = normalizeProvider(p);
    const key = configHash(cfg);
    const cached = this.listCache.get(key);
    if (cached) return cached;
    const promise = (async () => {
      const client = new McpStdioClient({
        command: cfg.command,
        args: cfg.args,
        env: providerEnv(cfg, ctx),
        cwd,
      });
      try {
        await client.start();
        const tools = await client.listTools();
        return cfg.allow ? tools.filter((t) => cfg.allow?.includes(t.name)) : tools;
      } finally {
        client.close();
      }
    })();
    this.listCache.set(key, promise);
    promise.catch(() => {
      if (this.listCache.get(key) === promise) this.listCache.delete(key);
    });
    return promise;
  }

  /** Build the provider tools for one role session. Providers whose tool list
   *  cannot be fetched are skipped with an `audit` event — a broken provider
   *  must not take the whole role down. */
  async buildRoleTools(opts: {
    ctx: ProviderContext;
    providers: ToolProviderConfig[];
    trace: () => ChainTrace;
    bus?: OrgBus;
    cwd?: string;
    reservedNames?: Set<string>;
  }): Promise<RoleProviderToolSet> {
    const { ctx, bus } = opts;
    const procs: ProviderProcess[] = [];
    const tools: OrgToolDef[] = [];
    const seen = new Set(opts.reservedNames ?? []);
    for (const raw of opts.providers) {
      const cfg = normalizeProvider(raw);
      let listed: McpToolInfo[];
      try {
        listed = await this.listTools(cfg, ctx, opts.cwd);
      } catch (err) {
        bus?.emit({
          type: 'audit',
          from: ctx.role,
          reason: 'tool-provider-list-failed',
          msg: `tool provider ${cfg.name}: could not list tools — ${err instanceof Error ? err.message : String(err)}`,
          data: { provider: cfg.name },
        });
        continue;
      }
      const proc = new ProviderProcess(cfg, ctx, opts.cwd, bus);
      procs.push(proc);
      const prefix = providerPrefix(cfg);
      for (const t of listed) {
        const exposed = `${prefix}__${t.name}`;
        if (seen.has(exposed)) continue;
        seen.add(exposed);
        tools.push({
          name: exposed,
          description: t.description || `Tool "${t.name}" from tool provider ${cfg.name}.`,
          schema: jsonSchemaToZodShape(t.inputSchema),
          handler: async (args) => ({
            text: await proc.call(t.name, args, {
              org: ctx.org,
              run: ctx.run,
              role: ctx.role,
              ...opts.trace(),
            }),
          }),
        });
      }
    }
    let closed = false;
    const set: RoleProviderToolSet = {
      tools,
      close: () => {
        if (closed) return;
        closed = true;
        for (const p of procs) p.close();
        this.sessions.get(ctx.org)?.delete(set);
      },
      pids: () => Object.fromEntries(procs.map((p) => [p.cfg.name, p.pid])),
    };
    if (procs.length > 0) {
      const forOrg = this.sessions.get(ctx.org) ?? new Set();
      forOrg.add(set);
      this.sessions.set(ctx.org, forOrg);
    }
    return set;
  }

  /** Kill every provider process of every live session of `org`. */
  closeOrg(org: string): void {
    const forOrg = this.sessions.get(org);
    if (!forOrg) return;
    for (const s of [...forOrg]) s.close();
    this.sessions.delete(org);
  }

  closeAll(): void {
    for (const org of [...this.sessions.keys()]) this.closeOrg(org);
  }
}
