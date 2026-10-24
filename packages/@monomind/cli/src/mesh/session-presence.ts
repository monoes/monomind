import { callWithHub, type Reply } from './client.js';
import type { HelloFields } from './protocol.js';

export type JoinInput = Omit<HelloFields, 'tier' | 'capabilities' | 'tags'> & {
  capabilities?: string[];
  tags?: string[];
};
type Call = (req: Record<string, unknown>) => Promise<Reply>;

let seq = 0;
const nextId = () => `p${process.pid}-${seq++}`;

export function createSessionPresence(call: Call = (r) => callWithHub(r), intervalMs = 15_000) {
  let reg: { addr: string; key: string; hello: Record<string, unknown> } | undefined;
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
    const r = await call({ ...hello, ...(key ? { key } : {}), id: nextId() });
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

  return {
    join: (i: JoinInput): Promise<string> =>
      serial(async () => {
        stopTimer();
        await beating; // an old beat must not overwrite the registration made below
        const hello = { op: 'hello', tier: 'session', capabilities: [], tags: [], ...i };
        const got = await register(hello, reg?.key);
        reg = { ...got, hello };
        timer = setInterval(tick, intervalMs);
        timer.unref();
        return got.addr;
      }),
    leave: (): Promise<void> =>
      serial(async () => {
        stopTimer();
        await beating; // so the bye carries the newest key and no hello can land after it
        const current = reg;
        reg = undefined;
        if (!current) return;
        try {
          await call({ op: 'bye', id: nextId(), addr: current.addr, key: current.key });
        } catch {
          /* hub gone: presence expires on its own */
        }
      }),
    addr: () => reg?.addr,
  };
}

export const sessionPresence = createSessionPresence();
