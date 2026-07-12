// packages/@monomind/cli/src/orgrt/forwarder.ts
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { OrgBus } from './bus.js';
import type { BusEvent } from './types.js';

/**
 * Forwards every bus event to the running mastermind control server
 * (dist/src/ui/server.mjs, POST /api/mastermind/event) so the existing
 * dashboard shows org activity. Best-effort: failures are dropped.
 *
 * Events are translated into the dashboard's native vocabulary
 * (org:start / org:comms / org:agent:online|offline / org:artifact /
 * org:checkpoint / org:complete) so the Orgs panel and Chat tab render
 * them; every payload carries org + runId so the server routes it to the
 * run file. Event kinds without a native rendering (tool/usage/audit) are
 * forwarded as raw org:<type> — they still land in the run file and SSE.
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
      const payload = translate(e);
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

/** BusEvent → dashboard-native mastermind event. Exported for tests. */
export function translate(e: BusEvent): Record<string, unknown> {
  const base = {
    org: e.org,
    runId: e.run,
    session: `${e.org}:${e.run}`,
    domain: 'ops',
    ts: e.ts,
  };
  switch (e.type) {
    case 'chat':
      return { ...base, type: 'org:comms', from: e.from, to: 'all', msg: e.msg };
    case 'message':
    case 'xorg':
      return {
        ...base, type: 'org:comms', from: e.from, to: e.to,
        msg: e.subject ? `[${e.subject}] ${e.msg ?? ''}` : e.msg,
      };
    case 'asset':
      return {
        ...base, type: 'org:artifact', from: e.from,
        artifact: { label: basename(e.path ?? 'asset'), type: 'file', path: e.path, mimeType: 'text/plain' },
      };
    case 'status': {
      const msg = e.msg ?? '';
      if (msg.startsWith('org started'))
        return { ...base, type: 'org:start', goal: (e.data as { goal?: string } | undefined)?.goal ?? '' };
      if (msg === 'org stopped')
        return { ...base, type: 'org:complete' };
      if (msg === 'session starting')
        return { ...base, type: 'org:agent:online', role: e.from, title: e.from, agent_type: e.from };
      if (msg === 'session ended' || msg.startsWith('session error'))
        return { ...base, type: 'org:agent:offline', from: e.from, reason: msg };
      return { ...base, type: 'org:checkpoint', progress: msg, from: e.from };
    }
    default:
      // tool / usage / audit — no native widget; keep raw for run file + SSE
      return { ...e, ...base, type: `org:${e.type}` };
  }
}
