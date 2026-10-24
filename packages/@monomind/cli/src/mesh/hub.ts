import { randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { acquireDaemonLock, DaemonLockError, type DaemonLockHandle } from '../orgrt/daemon-lock.js';
import { hashKey, issueKey, keysMatch } from './identity.js';
import { buildAddr, type Request, RequestSchema } from './protocol.js';
import { DEFAULT_LIST_LIMIT, MeshStore, StoreError } from './store.js';

const MAX_LINE_BYTES = 64 * 1024;
/** A client that lets this much reply data pile up unread is dropped instead of buffered. */
const MAX_PENDING_OUT_BYTES = 1024 * 1024;
const MAX_CONNECTIONS = 256;

export function meshDir(): string {
  return process.env.MONOMIND_MESH_DIR || join(homedir(), '.monomind', 'mesh');
}
export function socketPathFor(dir: string): string {
  return join(dir, 'hub.sock');
}

/**
 * The name this host's hub lock is taken under. daemon-lock derives its (Linux abstract-socket)
 * name from the directory path and this string, and anyone can bind such a name, so a lock named
 * only after the path could be squatted by another user to keep the hub from ever starting.
 * Mixing in a secret kept inside the 0700 directory makes the name unguessable to them.
 */
async function lockName(dir: string): Promise<string> {
  const file = join(dir, 'lock-token');
  try {
    writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  // Another hub starting at the same moment may still be writing the token.
  for (let i = 0; i < 50; i++) {
    const token = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(token)) return `mesh-${token}`;
    await new Promise((r) => setTimeout(r, 10));
  }
  const fresh = randomBytes(32).toString('hex'); // an earlier hub died half-way through writing
  writeFileSync(file, fresh, { mode: 0o600 });
  return `mesh-${fresh}`;
}

/**
 * Why `dir` cannot be trusted to hold the hub socket, or undefined when it can: it must be a real
 * directory (not a symlink) owned by this user that nobody else can enter. Both the hub and its
 * clients check this, so a `MONOMIND_MESH_DIR` pointing somewhere shared or planted is refused.
 */
export function privateDirProblem(dir: string): string | undefined {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(dir);
  } catch {
    return 'mesh directory does not exist';
  }
  if (!st.isDirectory()) return 'mesh path is not a private directory';
  if (process.getuid && st.uid !== process.getuid())
    return 'mesh directory is not private (wrong owner)';
  if ((st.mode & 0o077) !== 0) return 'mesh directory is not private (group/other access)';
  return undefined;
}

export interface HubOptions {
  dir: string;
  host: string;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  staleMs?: number;
  goneMs?: number;
  sweepMs?: number;
  idleExitMs?: number;
  /** A connection that sends nothing for this long is closed (default 60 s). */
  connIdleMs?: number;
  /** A half-sent line must be finished within this long (default 5 s): defeats trickling bytes. */
  partialLineMs?: number;
  onIdle?: () => void;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

type Reply = Record<string, unknown>;

export class MeshHub {
  private readonly now: () => number;
  private readonly isAlive: (pid: number) => boolean;
  private readonly staleMs: number;
  private readonly goneMs: number;
  private readonly idleExitMs: number;
  private lastBusy: number;
  private idleFired = false;
  private timer?: NodeJS.Timeout;
  private readonly sockets = new Set<Socket>();

  private constructor(
    readonly socketPath: string,
    private readonly server: Server,
    private readonly store: MeshStore,
    private readonly lock: DaemonLockHandle,
    private readonly o: HubOptions,
  ) {
    this.now = o.now ?? Date.now;
    this.isAlive = o.isAlive ?? pidAlive;
    this.staleMs = o.staleMs ?? 30_000;
    this.goneMs = o.goneMs ?? 90_000;
    this.idleExitMs = o.idleExitMs ?? 120_000;
    this.lastBusy = this.now();
  }

  static async start(o: HubOptions): Promise<MeshHub> {
    mkdirSync(o.dir, { recursive: true, mode: 0o700 });
    chmodSync(o.dir, 0o700);
    const problem = privateDirProblem(o.dir);
    if (problem) throw new Error(problem);
    let lock: DaemonLockHandle;
    try {
      lock = await acquireDaemonLock(o.dir, await lockName(o.dir));
    } catch (e) {
      // The library's message names the lock, which here embeds the secret token.
      if (e instanceof DaemonLockError)
        throw new DaemonLockError(e.code, 'mesh hub lock not available');
      throw e;
    }
    let store: MeshStore | undefined;
    try {
      store = await MeshStore.open(join(o.dir, 'mesh.db'));
      const sock = socketPathFor(o.dir);
      try {
        unlinkSync(sock); // stale file from a killed hub; the lock proves nobody else owns it
      } catch {
        /* none */
      }
      const server = createServer();
      server.maxConnections = MAX_CONNECTIONS;
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(sock, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      // An accept-time error after startup (e.g. EMFILE) must not take the hub down.
      server.on('error', () => {});
      const hub = new MeshHub(sock, server, store, lock, o);
      server.on('connection', (s) => hub.onConnection(s));
      hub.timer = setInterval(() => hub.sweepNow(), o.sweepMs ?? 5_000);
      hub.timer.unref();
      return hub;
    } catch (e) {
      store?.close();
      lock.release();
      throw e;
    }
  }

  private onConnection(s: Socket): void {
    let buf = '';
    let partialSince = 0; // when the current unfinished line got its first byte
    this.sockets.add(s);
    s.on('close', () => this.sockets.delete(s));
    s.setEncoding('utf8');
    s.setTimeout(this.o.connIdleMs ?? 60_000, () => s.destroy());
    s.on('error', () => s.destroy());
    s.on('data', (chunk: string) => {
      const continuing = buf.length > 0;
      buf += chunk;
      if (continuing && Date.now() - partialSince > (this.o.partialLineMs ?? 5_000)) {
        return void s.destroy();
      }
      let finishedLine = false;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        finishedLine = true;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (Buffer.byteLength(line) > MAX_LINE_BYTES) return void s.destroy();
        s.write(`${JSON.stringify(this.handle(line))}\n`);
        // A client that never reads would otherwise make the hub queue unbounded reply data.
        if (s.writableLength > MAX_PENDING_OUT_BYTES) return void s.destroy();
      }
      // Only the unfinished tail counts against the line limit, not a chunk of many short lines.
      if (Buffer.byteLength(buf) > MAX_LINE_BYTES) return void s.destroy();
      if (buf.length > 0 && (!continuing || finishedLine)) partialSince = Date.now();
    });
  }

  private handle(line: string): Reply {
    this.lastBusy = this.now();
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return { id: '', ok: false, error: 'invalid' };
    }
    const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '';
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) return { id, ok: false, error: 'invalid' };
    try {
      return { id, ...this.dispatch(parsed.data) };
    } catch {
      // A store failure (disk full, corrupt row) must cost one request, not the whole hub.
      return { id, ok: false, error: 'internal' };
    }
  }

  /** True when `key` is the one issued for this live address (only its hash is stored). */
  private authorized(addr: string, key: string): boolean {
    const owner = this.store.keyHashOf(addr);
    return owner !== undefined && keysMatch(owner, hashKey(key));
  }

  /** The caller proves it owns a live address by its key, or by repeating the nonce it registered with. */
  private ownsAddress(addr: string, key?: string, nonce?: string): boolean {
    if (key && this.authorized(addr, key)) return true;
    const registered = this.store.nonceHashOf(addr);
    return nonce !== undefined && registered !== undefined && keysMatch(registered, hashKey(nonce));
  }

  private dispatch(r: Request): Reply {
    const t = this.now();
    switch (r.op) {
      case 'hello': {
        const addr = buildAddr(this.o.host, r.project, r.sessionId, r.agentId);
        // A live address belongs to whoever holds its key, also after a hub restart: nobody else
        // may take it over.
        if (this.store.keyHashOf(addr) !== undefined && !this.ownsAddress(addr, r.key, r.nonce)) {
          return { ok: false, error: 'addr_in_use' };
        }
        try {
          this.store.upsertAgent(addr, r, t);
        } catch (e) {
          if (e instanceof StoreError) {
            return { ok: false, error: e.code === 'LIMIT' ? 'limit' : 'alias_taken' };
          }
          throw e;
        }
        const key = issueKey();
        this.store.setKeyHash(addr, hashKey(key), r.nonce ? hashKey(r.nonce) : undefined);
        return { ok: true, addr, key };
      }
      case 'heartbeat':
        if (!this.authorized(r.addr, r.key)) return { ok: false, error: 'unauthorized' };
        return this.store.heartbeat(r.addr, t, r.task)
          ? { ok: true }
          : { ok: false, error: 'gone' };
      case 'bye':
        if (!this.authorized(r.addr, r.key)) return { ok: false, error: 'unauthorized' };
        this.store.bye(r.addr);
        return { ok: true };
      case 'send': {
        if (!this.authorized(r.addr, r.key)) return { ok: false, error: 'unauthorized' };
        const project = this.store.projectOf(r.addr);
        const to = project ? this.store.resolve(project, r.to) : undefined;
        if (!to) return { ok: false, error: 'unknown_recipient' };
        try {
          const seq = this.store.addMessage(r.addr, to, r.kind, r.body, t, r.replyTo);
          return { ok: true, seq, to };
        } catch (e) {
          if (e instanceof StoreError && e.code === 'INBOX_FULL') {
            return { ok: false, error: 'inbox_full' };
          }
          throw e;
        }
      }
      case 'inbox': {
        if (!this.authorized(r.addr, r.key)) return { ok: false, error: 'unauthorized' };
        return { ok: true, ...this.store.takeInbox(r.addr, r.limit, r.peek) };
      }
      case 'who': {
        // One extra row tells the caller the list was cut off instead of looking complete.
        const rows = this.store.list(r, DEFAULT_LIST_LIMIT + 1);
        return {
          ok: true,
          agents: rows.slice(0, DEFAULT_LIST_LIMIT),
          truncated: rows.length > DEFAULT_LIST_LIMIT,
        };
      }
    }
  }

  /** One presence pass: stale/gone transitions, idle-exit check. */
  sweepNow(): void {
    const t = this.now();
    this.store.sweep(t, this.staleMs, this.goneMs, this.isAlive);
    if (this.store.liveCount() > 0) this.lastBusy = t;
    if (!this.idleFired && t - this.lastBusy >= this.idleExitMs) {
      this.idleFired = true;
      this.o.onIdle?.();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    // Remove the socket while the lock is still held: after release a successor may already be
    // listening on this path and must not have its fresh socket deleted.
    try {
      unlinkSync(this.socketPath);
    } catch {
      /* already gone */
    }
    this.store.close();
    this.lock.release();
  }
}
