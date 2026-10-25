import { randomBytes } from 'node:crypto';
import { callWithHub, meshCall, type Reply } from './client.js';
import { meshDir } from './hub.js';
import type { HelloFields, Tier } from './protocol.js';
import { createSessionFiles } from './session-files.js';

export type JoinInput = Omit<HelloFields, 'tier' | 'capabilities' | 'tags'> & {
  /** Defaults to `session`; processes Monomind launches register as `external` / `org-role`. */
  tier?: Tier;
  capabilities?: string[];
  tags?: string[];
};
type Call = (req: Record<string, unknown>) => Promise<Reply>;

const aliasOf = (hello: Record<string, unknown>) =>
  typeof hello.alias === 'string' ? hello.alias : undefined;

let seq = 0;
const nextId = () => `p${process.pid}-${seq++}`;

/**
 * `call` may start a hub (join, heartbeat re-registration); `byeCall` must not: saying goodbye to a
 * hub that is already gone is not worth starting one.
 */
export function createSessionPresence(
  call: Call = (r) => callWithHub(r),
  intervalMs = 15_000,
  byeCall: Call = call,
  /** Told the credentials whenever they change (join, re-registration) and when they go away. */
  onAuth: (auth: { addr: string; key: string; alias?: string } | undefined) => void = () => {},
) {
  let reg: { addr: string; key: string; hello: Record<string, unknown> } | undefined;
  /** The key of a registration whose bye did not get through, so a later join can take it back. */
  let resume: { addr: string; key: string } | undefined;
  let timer: NodeJS.Timeout | undefined;
  let beating: Promise<void> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  /** join and leave never overlap each other, so they cannot leave two timers or a stale `reg`. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  /** `key` proves we own the address when it is still live at the hub (hub restart, re-join). */
  async function register(
    hello: Record<string, unknown>,
    key?: string,
  ): Promise<{ addr: string; key: string }> {
    // The nonce is fixed for this attempt, so a retry of a lost reply is recognised by the hub.
    const nonce = randomBytes(16).toString('hex');
    const r = await call({ ...hello, ...(key ? { key } : {}), nonce, id: nextId() });
    if (!r.ok) throw new Error(String(r.error ?? 'hello failed'));
    return { addr: r.addr as string, key: r.key as string };
  }

  async function beat(): Promise<void> {
    const cur = reg;
    if (!cur) return;
    try {
      const r = await call({ op: 'heartbeat', id: nextId(), addr: cur.addr, key: cur.key });
      if (!r.ok && (r.error === 'unauthorized' || r.error === 'gone')) {
        const again = await register(cur.hello, cur.key);
        reg = { ...cur, ...again };
        onAuth({ addr: reg.addr, key: reg.key, alias: aliasOf(cur.hello) });
      }
    } catch {
      /* hub unreachable, or it refused to give the address back: the next tick retries */
    }
  }

  /** One heartbeat at a time: a slow hub must not pile up overlapping beats. */
  function tick(): void {
    if (beating || !reg) return;
    beating = beat().finally(() => {
      beating = undefined;
    });
  }

  function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function startTimer(): void {
    timer = setInterval(tick, intervalMs);
    timer.unref();
  }

  return {
    join: (i: JoinInput): Promise<string> =>
      serial(async () => {
        stopTimer();
        await beating; // an old beat must not overwrite the registration made below
        const hello = { op: 'hello', tier: 'session', capabilities: [], tags: [], ...i };
        let got: { addr: string; key: string };
        try {
          got = await register(hello, reg?.key ?? resume?.key);
        } catch (e) {
          if (reg) startTimer(); // a refused re-join must not stop the registration we still hold
          throw e;
        }
        resume = undefined;
        reg = { ...got, hello };
        onAuth({ addr: got.addr, key: got.key, alias: aliasOf(hello) });
        startTimer();
        return got.addr;
      }),
    leave: (): Promise<void> =>
      serial(async () => {
        stopTimer();
        await beating; // so the bye carries the newest key and no hello can land after it
        const current = reg;
        reg = undefined;
        onAuth(undefined);
        if (!current) return;
        try {
          await byeCall({ op: 'bye', id: nextId(), addr: current.addr, key: current.key });
          resume = undefined;
        } catch {
          // Hub unreachable: presence expires on its own, but keep the key so a quick re-join can
          // take the address back instead of being refused as taken until the sweep frees it.
          resume = { addr: current.addr, key: current.key };
        }
      }),
    addr: () => reg?.addr,
    /** The address and key hub calls made on this session's behalf must carry. */
    auth: () => (reg ? { addr: reg.addr, key: reg.key } : undefined),
  };
}

const sessionFiles = createSessionFiles(meshDir());
process.on('exit', () => sessionFiles.remove());

export const sessionPresence = createSessionPresence(
  (r) => callWithHub(r),
  15_000,
  (r) => meshCall(r),
  (auth) => (auth ? sessionFiles.write(auth) : sessionFiles.remove()),
);
