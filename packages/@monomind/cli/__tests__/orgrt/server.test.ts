// packages/@monomind/cli/__tests__/orgrt/server.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { startOrgServer } from '../../src/orgrt/server.js';

const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

describe('org live server', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('broadcasts bus events to WebSocket clients and serves live.html + /api/orgs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'srv-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }],
    }));
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const srv = await startOrgServer(daemon, 0); // 0 = ephemeral port
    close = srv.close;

    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const events: any[] = [];
    ws.on('message', d => events.push(JSON.parse(d.toString())));
    await new Promise(r => ws.on('open', r));

    await daemon.startOrg('alpha');
    await new Promise(r => setTimeout(r, 300));
    await daemon.stopAll();

    expect(events.some(e => e.type === 'status')).toBe(true);

    const page = await fetch(`http://127.0.0.1:${srv.port}/`).then(r => r.text());
    expect(page).toContain('org live');
    const orgs = await fetch(`http://127.0.0.1:${srv.port}/api/orgs`).then(r => r.json());
    expect(Array.isArray(orgs)).toBe(true);
    ws.close();
  });
});
