// packages/@monomind/cli/src/orgrt/pty-runner.ts
/**
 * PTY execution + live attach — runs one of the SpawnProcess-seamed
 * subprocess runners (grok/qwen/crush/copilot/pi-runner.ts) inside a real
 * pseudo-terminal instead of plain stdio pipes, and lets an operator watch
 * or type into that live session from a separate `monomind org attach`
 * invocation.
 *
 * Why a PTY at all: some CLIs behave differently without one — interactive
 * first-run prompts, full-screen/ANSI rendering, or TTY-detection branches
 * that alter output shape. A real pseudo-terminal makes the child process
 * see a TTY exactly like a human running it in a terminal would.
 *
 * `node-pty` is an OPTIONAL dependency, dynamically imported only from
 * createPtySpawnProcess() — same "missing dep degrades to a clear error, not
 * a crash at import time" convention the other subprocess runners use for
 * their own no-new-hard-dependency rule (see kimicode-runner.ts's header).
 *
 * Two independent pieces live here:
 *   1. createPtySpawnProcess() — a SpawnProcess implementation any of the
 *      subprocess runners can be constructed with (they already accept one
 *      via their constructor's `spawnProcess` param), backed by node-pty.
 *      stdout carries the PTY's single combined output stream (PTYs merge
 *      stdout+stderr — there's no separate stderr channel); stderr is
 *      always empty here.
 *   2. PtyAttachHub / PtyAttachRegistry — the live-attach relay: a role
 *      running under PTY mode registers its live pty with the registry,
 *      which listens on a per-role Unix domain socket. `org attach`
 *      connects to that socket and the hub relays bytes bidirectionally
 *      (keystrokes in, terminal output out) plus terminal-resize events,
 *      using a minimal framing on the client→server direction only (server
 *      → client is raw PTY bytes, meant for direct terminal rendering).
 *
 * Client→server frame: `[1-byte tag][4-byte BE length][payload]`.
 *   tag 0x00 = data  (payload = raw keystroke bytes, written to pty.write)
 *   tag 0x01 = resize (payload = 4-byte BE cols + 4-byte BE rows)
 * Server→client: no framing — raw pty output bytes, written straight to
 * the attach client's stdout.
 */
import { createServer as createUnixServer, type Server, type Socket } from 'node:net';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { SpawnProcess, SpawnedProcess } from './grok-runner.js';

export type { SpawnProcess, SpawnedProcess } from './grok-runner.js';

/** The subset of node-pty's IPty this module depends on — kept narrow and
 *  local so tests can supply a fake implementation without the native
 *  module installed. */
export interface PtyLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
}

/** Wraps a PtyLike into the SpawnedProcess duck-type the subprocess runners
 *  consume (stdout as async-iterable Buffer stream, stderr always empty,
 *  on('error'|'close'), kill()). Exported for unit testing the adapter in
 *  isolation from node-pty. */
export function ptyToSpawnedProcess(pty: PtyLike, spawnError?: Error): SpawnedProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stderr.end(); // PTYs merge stdout+stderr — nothing ever arrives on stderr
  const emitter = new EventEmitter();

  pty.onData((data) => { stdout.write(Buffer.from(data, 'utf8')); });
  pty.onExit(({ exitCode }) => { stdout.end(); emitter.emit('close', exitCode); });

  if (spawnError) {
    // Mirror child_process's async 'error' event contract: emit on next
    // tick so a caller that attaches `.on('error', ...)` immediately after
    // this call (the same pattern used for child_process.spawn) still
    // catches it.
    queueMicrotask(() => emitter.emit('error', spawnError));
  }

  return {
    stdout,
    stderr,
    on: (event: string, cb: (...a: unknown[]) => void) => { emitter.on(event, cb); },
    kill: (signal?: string) => pty.kill(signal),
  } as unknown as SpawnedProcess;
}

export interface PtySpawnOptions {
  /** Terminal size for the spawned pty. Defaults to a generous headless size
   *  since there's no real terminal attached until/unless `org attach` connects. */
  cols?: number;
  rows?: number;
  /** Called with the live PtyLike right after spawn, so the daemon can
   *  register it with a PtyAttachRegistry for `org attach`. */
  onSpawn?: (pty: PtyLike) => void;
}

type NodePtyModule = { spawn: (file: string, args: string[], o: Record<string, unknown>) => PtyLike };

/**
 * Builds a SpawnProcess backed by node-pty. This is an ASYNC factory —
 * `node-pty` is an optional dependency loaded via dynamic import()
 * (this module is ESM, so a synchronous require() isn't available) — so the
 * one-time module load happens here, once, at role-setup time. The
 * SpawnProcess closure this returns is fully synchronous per call, exactly
 * matching the contract every subprocess runner already expects (no changes
 * needed to grok/qwen/crush/copilot/pi-runner.ts's call sites).
 *
 * Rejects with a clear, actionable error if `node-pty` isn't installed —
 * callers should surface that once at role setup, not crash at module
 * import time for orgs that never use PTY mode. */
// node-pty is an optional dependency (may not be installed/built) — imported
// via a non-literal specifier so TypeScript treats the dynamic import()
// result as `any` instead of trying (and failing) to resolve its types.
const NODE_PTY_MODULE_SPECIFIER = 'node-pty';

export async function createPtySpawnProcess(opts: PtySpawnOptions = {}): Promise<SpawnProcess> {
  let nodePty: NodePtyModule;
  try {
    nodePty = (await import(NODE_PTY_MODULE_SPECIFIER)) as unknown as NodePtyModule;
  } catch {
    throw new Error(
      'PTY mode requires the optional "node-pty" package. Install it: ' +
      'npm install node-pty (or pnpm add node-pty), or set role.pty=false to ' +
      'use plain (non-PTY) subprocess execution.',
    );
  }

  return (bin, args, spawnOpts) => {
    let pty: PtyLike;
    try {
      pty = nodePty.spawn(bin, args, {
        name: 'xterm-256color',
        cols: opts.cols ?? 120,
        rows: opts.rows ?? 40,
        cwd: spawnOpts.cwd,
        env: spawnOpts.env,
      });
    } catch (err) {
      // A real spawn failure (e.g. the target binary is missing) — match
      // child_process.spawn's async 'error' event contract rather than
      // throwing synchronously from the SpawnProcess call.
      const deadEmitter = new EventEmitter();
      queueMicrotask(() => deadEmitter.emit('error', err as Error));
      const deadStdout = new PassThrough(); deadStdout.end();
      const deadStderr = new PassThrough(); deadStderr.end();
      return {
        stdout: deadStdout,
        stderr: deadStderr,
        on: (event: string, cb: (...a: unknown[]) => void) => { deadEmitter.on(event, cb); },
        kill: () => {},
      } as unknown as SpawnedProcess;
    }
    opts.onSpawn?.(pty);
    return ptyToSpawnedProcess(pty);
  };
}

// ── Attach relay: framing ───────────────────────────────────────────────

export const FRAME_TAG_DATA = 0x00;
export const FRAME_TAG_RESIZE = 0x01;

/** Encode a client→server data frame (raw keystroke bytes). */
export function encodeDataFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(FRAME_TAG_DATA, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/** Encode a client→server resize frame. */
export function encodeResizeFrame(cols: number, rows: number): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(FRAME_TAG_RESIZE, 0);
  header.writeUInt32BE(8, 1);
  const payload = Buffer.alloc(8);
  payload.writeUInt32BE(cols, 0);
  payload.writeUInt32BE(rows, 4);
  return Buffer.concat([header, payload]);
}

export type DecodedFrame =
  | { kind: 'data'; payload: Buffer }
  | { kind: 'resize'; cols: number; rows: number };

/**
 * Incremental frame decoder: feed it arbitrary byte chunks (as a socket
 * delivers them) and it yields every complete frame found so far, retaining
 * any trailing partial frame internally for the next feed() call. Exported
 * for unit testing the framing protocol without a real socket.
 */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  feed(chunk: Buffer): DecodedFrame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames: DecodedFrame[] = [];
    for (;;) {
      if (this.buf.length < 5) break;
      const tag = this.buf.readUInt8(0);
      const len = this.buf.readUInt32BE(1);
      if (this.buf.length < 5 + len) break;
      const payload = this.buf.subarray(5, 5 + len);
      this.buf = this.buf.subarray(5 + len);
      if (tag === FRAME_TAG_DATA) {
        frames.push({ kind: 'data', payload: Buffer.from(payload) });
      } else if (tag === FRAME_TAG_RESIZE && len === 8) {
        frames.push({ kind: 'resize', cols: payload.readUInt32BE(0), rows: payload.readUInt32BE(4) });
      }
      // Unknown tag: frame is dropped (length-prefixed, so we can still
      // skip past it cleanly) rather than desyncing the stream.
    }
    return frames;
  }
}

// ── Attach relay: registry (server side, lives in the daemon process) ───

/** Where `org attach` sockets live for a project: a dedicated hidden
 *  subdirectory of ORG_DIR (`.monomind/orgs/.pty/`), kept separate from the
 *  `<org>-*.json` artifact-file naming convention the rest of org.ts uses
 *  (see ORG_ARTIFACT_SUFFIXES in commands/org.ts) so it never collides with
 *  org-config discovery. Exported so both the daemon (registry side) and
 *  the standalone `org attach` CLI process (client side) compute the exact
 *  same path from just `orgsDir` (ORG_DIR resolved against project cwd). */
export function attachSocketPath(orgsDir: string, org: string, role: string): string {
  return `${orgsDir}/.pty/${org}__${role}.sock`;
}

/** Drives one live attach relay for a single pty. Exported for unit testing
 *  the relay logic against a fake PtyLike + fake duplex socket, independent
 *  of net.Server/net.Socket. */
type AttachClient = { write: (chunk: Buffer) => void };

export class PtyAttachHub {
  private decoder = new FrameDecoder();
  private pty: PtyLike;
  private client: AttachClient | undefined;

  constructor(pty: PtyLike) {
    this.pty = pty;
    this.subscribeData();
  }

  /** Point this hub at a NEW pty (the subprocess runners spawn one process
   *  PER TURN — grok/qwen/pi persist a session, crush/copilot don't, but
   *  either way each turn's real pty is a distinct process). Any currently
   *  attached client stays attached across the rebind, seamlessly following
   *  whichever turn's pty is live now — that's the whole point of rebind
   *  over "one hub per pty": without it, `org attach` would only ever see
   *  the first turn's (likely already-exited) process. */
  rebind(pty: PtyLike): void {
    this.pty = pty;
    this.subscribeData();
  }

  private subscribeData(): void {
    // Bound to `this.pty` at subscribe time, not captured for the hub's
    // lifetime — after a rebind, the previous pty's listener keeps existing
    // (node-pty's onData has no unsubscribe in older versions) but that pty
    // has necessarily either exited or is about to; any trailing events it
    // still emits harmlessly forward to whatever client is attached right
    // now, same as the current pty would.
    this.pty.onData((data: string) => { this.client?.write(Buffer.from(data, 'utf8')); });
  }

  /** Wire a connected client socket-like object into the relay. Returns a
   *  detach function. */
  attach(client: { on: (event: 'data' | 'close', cb: (chunk?: Buffer) => void) => void; write: (chunk: Buffer) => void }): () => void {
    this.client = client;
    client.on('data', (chunk?: Buffer) => {
      if (this.client !== client || !chunk) return;
      for (const frame of this.decoder.feed(chunk)) {
        if (frame.kind === 'data') this.pty.write(frame.payload.toString('utf8'));
        else this.pty.resize(frame.cols, frame.rows);
      }
    });
    return () => { if (this.client === client) this.client = undefined; };
  }
}

export class PtyAttachRegistry {
  private servers = new Map<string, Server>();
  private hubs = new Map<string, PtyAttachHub>();

  /** Start listening for `org attach` connections for one role's live pty,
   *  or — if a socket is already listening for this (org, role) from an
   *  earlier turn — rebind the existing hub to the new turn's pty instead
   *  of creating a second server (see PtyAttachHub.rebind). `orgsDir` is
   *  ORG_DIR resolved against the project cwd (`.monomind/orgs`). Only one
   *  client may be attached at a time — a second connection while one is
   *  active is rejected with a short message, not queued. */
  register(orgsDir: string, org: string, role: string, pty: PtyLike): void {
    const key = `${orgsDir}::${org}::${role}`;
    const existingHub = this.hubs.get(key);
    if (existingHub) { existingHub.rebind(pty); return; }

    const path = attachSocketPath(orgsDir, org, role);
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) unlinkSync(path); // stale socket from a crashed prior run

    const hub = new PtyAttachHub(pty);
    this.hubs.set(key, hub);
    let attached = false;
    const server = createUnixServer((socket: Socket) => {
      if (attached) {
        socket.end('monomind: another attach session is already active for this role\n');
        return;
      }
      attached = true;
      const detach = hub.attach({
        on: (event, cb) => { socket.on(event, cb as (chunk?: Buffer) => void); },
        write: (chunk) => { if (!socket.destroyed) socket.write(chunk); },
      });
      const onEnd = () => { attached = false; detach(); };
      socket.on('close', onEnd);
      socket.on('error', onEnd);
    });
    server.listen(path);
    this.servers.set(key, server);
  }

  unregister(orgsDir: string, org: string, role: string): void {
    const key = `${orgsDir}::${org}::${role}`;
    const server = this.servers.get(key);
    if (!server) return;
    server.close();
    this.servers.delete(key);
    this.hubs.delete(key);
    const path = attachSocketPath(orgsDir, org, role);
    try { if (existsSync(path)) unlinkSync(path); } catch { /* best-effort cleanup */ }
  }
}

/** Shared singleton — one registry per daemon process, mirroring the module-
 *  level singleton pattern other orgrt files use for process-wide state. */
export const ptyAttachRegistry = new PtyAttachRegistry();

// ── PTY-mode runner construction ────────────────────────────────────────

import type { AgentRunner } from './agent-runner.js';
import { GrokAgentRunner } from './grok-runner.js';
import { QwenAgentRunner } from './qwen-runner.js';
import { CrushAgentRunner } from './crush-runner.js';
import { CopilotAgentRunner } from './copilot-runner.js';
import { PiAgentRunner } from './pi-runner.js';

/** The subprocess runtimes that accept an injectable SpawnProcess and can
 *  therefore run under a real pty. (codex/kimicode/opencode/antigravity
 *  don't have the seam yet — see the plan note on scope.) */
export const PTY_CAPABLE_RUNTIMES = ['grok', 'qwen', 'crush', 'copilot', 'pi'] as const;
export type PtyCapableRuntime = (typeof PTY_CAPABLE_RUNTIMES)[number];

export function isPtyCapableRuntime(kind: string | undefined): kind is PtyCapableRuntime {
  return !!kind && (PTY_CAPABLE_RUNTIMES as readonly string[]).includes(kind);
}

/**
 * Build the pty-mode variant of one of the 5 pty-capable runners, wiring its
 * live pty into `ptyAttachRegistry` under (orgsDir, org, role) as soon as
 * each turn spawns a process — so `monomind org attach <org> <role>` can
 * find it. Throws (does not silently fall back) if node-pty isn't
 * installed; callers should catch this once at role-session-start and
 * degrade to the non-pty runner rather than crash the whole role.
 */
export async function buildPtyRunner(
  runtime: PtyCapableRuntime,
  orgsDir: string,
  org: string,
  role: string,
): Promise<AgentRunner> {
  const spawnProcess = await createPtySpawnProcess({
    onSpawn: (pty) => ptyAttachRegistry.register(orgsDir, org, role, pty),
  });
  switch (runtime) {
    case 'grok': return new GrokAgentRunner(undefined, spawnProcess);
    case 'qwen': return new QwenAgentRunner(undefined, spawnProcess);
    case 'copilot': return new CopilotAgentRunner(undefined, spawnProcess);
    case 'pi': return new PiAgentRunner(undefined, spawnProcess);
    case 'crush': return new CrushAgentRunner({ spawnProcess });
  }
}
