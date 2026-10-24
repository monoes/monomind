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

  async function register(hello: Record<string, unknown>): Promise<{ addr: string; key: string }> {
    const r = await call({ ...hello, id: nextId() });
    if (!r.ok) throw new Error(String(r.error ?? 'hello failed'));
    return { addr: r.addr as string, key: r.key as string };
  }

  async function beat(): Promise<void> {
    if (!reg) return;
    try {
      const r = await call({ op: 'heartbeat', id: nextId(), addr: reg.addr, key: reg.key });
      if (!r.ok && (r.error === 'unauthorized' || r.error === 'gone')) {
        const again = await register(reg.hello);
        reg = { ...reg, ...again };
      }
    } catch {
      /* hub unreachable or refusing: the next tick retries */
    }
  }

  function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return {
    async join(i: JoinInput): Promise<string> {
      stopTimer();
      const hello = { op: 'hello', tier: 'session', capabilities: [], tags: [], ...i };
      const got = await register(hello);
      reg = { ...got, hello };
      timer = setInterval(() => void beat(), intervalMs);
      timer.unref();
      return got.addr;
    },
    async leave(): Promise<void> {
      stopTimer();
      const current = reg;
      reg = undefined;
      if (!current) return;
      try {
        await call({ op: 'bye', id: nextId(), addr: current.addr, key: current.key });
      } catch {
        /* hub gone: presence expires on its own */
      }
    },
    addr: () => reg?.addr,
  };
}

export const sessionPresence = createSessionPresence();
