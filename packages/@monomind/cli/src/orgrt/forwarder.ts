// packages/@monomind/cli/src/orgrt/forwarder.ts
import { readFileSync, existsSync } from 'node:fs';
import type { OrgBus } from './bus.js';
import type { BusEvent } from './types.js';

/**
 * Forwards every bus event to the running mastermind control server
 * (dist/src/ui/server.mjs, POST /api/mastermind/event) so the existing
 * dashboard SSE stream shows org activity. Best-effort: failures are dropped.
 */
export function attachForwarder(bus: OrgBus, controlJsonPath = '.monomind/control.json') {
  let chain: Promise<void> = Promise.resolve();
  const baseUrl = (): string | null => {
    try {
      if (!existsSync(controlJsonPath)) return null;
      const c = JSON.parse(readFileSync(controlJsonPath, 'utf8'));
      return typeof c.url === 'string' ? c.url : `http://localhost:${c.port ?? 4242}`;
    } catch { return null; }
  };

  const unsubscribe = bus.subscribe((e: BusEvent) => {
    chain = chain.then(async () => {
      const url = baseUrl();
      if (!url) return;
      const payload = { ...e, type: `org:${e.type}`, session: `${e.org}:${e.run}`, domain: 'ops' };
      await fetch(`${url}/api/mastermind/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      }).then(r => { r.body?.cancel(); }).catch(() => {});
    }).catch(() => {});
  });

  return { settle: () => chain, unsubscribe };
}
