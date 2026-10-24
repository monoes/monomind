import { chmodSync, mkdirSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { acquireDaemonLock, type DaemonLockHandle } from '../orgrt/daemon-lock.js';
import { issueKey, keysMatch } from './identity.js';
import { RequestSchema, buildAddr, type Request } from './protocol.js';
import { MeshStore, StoreError } from './store.js';

const MAX_LINE_BYTES = 64 * 1024;

export function meshDir(): string {
  return process.env.MONOMIND_MESH_DIR || join(homedir(), '.monomind', 'mesh');
}
export function socketPathFor(dir: string): string {
  return join(dir, 'hub.sock');
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
  private readonly keys = new Map<string, string>();
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
    const lock = await acquireDaemonLock(o.dir, 'mesh');
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
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(sock, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
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
    this.sockets.add(s);
    s.on('close', () => this.sockets.delete(s));
    s.setEncoding('utf8');
    s.on('error', () => s.destroy());
    s.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_LINE_BYTES) return void s.destroy();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        s.write(JSON.stringify(this.handle(line)) + '\n');
      }
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
    return { id, ...this.dispatch(parsed.data) };
  }

  private authorized(addr: string, key: string): boolean {
    const k = this.keys.get(addr);
    return k !== undefined && keysMatch(k, key);
  }

  private dispatch(r: Request): Reply {
    const t = this.now();
    switch (r.op) {
      case 'hello': {
        const addr = buildAddr(this.o.host, r.project, r.sessionId, r.agentId);
        try {
          this.store.upsertAgent(addr, r, t);
        } catch (e) {
          if (e instanceof StoreError) return { ok: false, error: 'alias_taken' };
          throw e;
        }
        const key = issueKey();
        this.keys.set(addr, key);
        return { ok: true, addr, key };
      }
      case 'heartbeat':
        if (!this.authorized(r.addr, r.key)) return { ok: false, error: 'unauthorized' };
        return this.store.heartbeat(r.addr, t, r.task) ? { ok: true } : { ok: false, error: 'gone' };
      case 'bye':
        if (!this.authorized(r.addr, r.key)) return { ok: false, error: 'unauthorized' };
        this.store.bye(r.addr);
        this.keys.delete(r.addr);
        return { ok: true };
      case 'who':
        return { ok: true, agents: this.store.list(r) };
    }
  }

  /** One presence pass: stale/gone transitions, key cleanup, idle-exit check. */
  sweepNow(): void {
    const t = this.now();
    const { gone } = this.store.sweep(t, this.staleMs, this.goneMs, this.isAlive);
    for (const addr of gone) this.keys.delete(addr);
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
    this.store.close();
    this.lock.release();
    try {
      unlinkSync(this.socketPath);
    } catch {
      /* already gone */
    }
  }
}
