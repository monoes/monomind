import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { meshDir, privateDirProblem, socketPathFor } from './hub.js';

export class MeshOfflineError extends Error {
  constructor(message = 'mesh hub unreachable') {
    super(message);
    this.name = 'MeshOfflineError';
  }
}

export type Reply = { id: string; ok: boolean; [k: string]: unknown };
export interface CallOptions {
  dir?: string;
  timeoutMs?: number;
}

/** One request/reply over the hub socket. Any transport failure is MeshOfflineError. */
export function meshCall(req: Record<string, unknown>, o: CallOptions = {}): Promise<Reply> {
  const dir = o.dir ?? meshDir();
  // Never hand a key to a socket in a directory somebody else could have made or entered.
  const problem = privateDirProblem(dir);
  if (problem) return Promise.reject(new MeshOfflineError(problem));
  return new Promise((resolve, reject) => {
    const s = connect(socketPathFor(dir));
    let buf = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.destroy();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new MeshOfflineError('mesh hub timed out'))),
      o.timeoutMs ?? 500,
    );
    s.setEncoding('utf8');
    s.once('connect', () => s.write(`${JSON.stringify(req)}\n`));
    s.on('data', (c: string) => {
      buf += c;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      try {
        const reply = JSON.parse(buf.slice(0, nl)) as Reply;
        finish(() => resolve(reply));
      } catch {
        finish(() => reject(new MeshOfflineError('mesh hub sent a malformed reply')));
      }
    });
    s.on('close', () =>
      finish(() => reject(new MeshOfflineError('mesh hub closed the connection'))),
    );
    s.on('error', () => finish(() => reject(new MeshOfflineError())));
  });
}

function spawnDetachedHub(dir: string): void {
  const entry = fileURLToPath(new URL('./hub-main.js', import.meta.url));
  spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, MONOMIND_MESH_DIR: dir },
  }).unref();
}

/** Per mesh dir: when a hub was last spawned, and until when a failed start-up is not retried. */
const spawnState = new Map<string, { lastSpawn: number; failedUntil: number }>();

/**
 * meshCall, starting the hub on first use. Throws MeshOfflineError if it never comes up.
 *
 * A hub that cannot start (missing native module, squatted lock) must not turn every heartbeat
 * and every `mesh_who` into a new process and a multi-second wait: spawns are rate limited per
 * directory, and after a failed start-up further calls fail fast for `failCooldownMs`.
 */
export async function callWithHub(
  req: Record<string, unknown>,
  o: CallOptions & {
    spawnHub?: (dir: string) => void;
    retries?: number;
    retryDelayMs?: number;
    spawnBackoffMs?: number;
    failCooldownMs?: number;
  } = {},
): Promise<Reply> {
  const dir = o.dir ?? meshDir();
  try {
    return await meshCall(req, { dir, timeoutMs: o.timeoutMs });
  } catch (e) {
    if (!(e instanceof MeshOfflineError)) throw e;
  }
  let st = spawnState.get(dir);
  if (!st) spawnState.set(dir, (st = { lastSpawn: 0, failedUntil: 0 }));
  if (Date.now() < st.failedUntil) throw new MeshOfflineError('mesh hub is not starting');
  const backoff = o.spawnBackoffMs ?? 2_000;
  const spawnIfDue = () => {
    if (Date.now() - st.lastSpawn < backoff) return;
    st.lastSpawn = Date.now();
    (o.spawnHub ?? spawnDetachedHub)(dir);
  };
  spawnIfDue();
  // ~6 s: a cold hub starts in 0.1-0.5 s, but a loaded host (many sessions) can take several times that.
  const retries = o.retries ?? 40;
  for (let i = 0; i < retries; i++) {
    await new Promise((r) => setTimeout(r, o.retryDelayMs ?? 150));
    try {
      return await meshCall(req, { dir, timeoutMs: o.timeoutMs });
    } catch (e) {
      if (!(e instanceof MeshOfflineError)) throw e;
    }
    // A spawn can lose a shutdown race with the hub it is replacing; try again now and then.
    if ((i + 1) % 10 === 0) spawnIfDue();
  }
  st.failedUntil = Date.now() + (o.failCooldownMs ?? 15_000);
  throw new MeshOfflineError('mesh hub did not start');
}
