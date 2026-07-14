// packages/@monomind/cli/__tests__/orgrt/server.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { startOrgServer } from '../../src/orgrt/server.js';

const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

describe('org xdeliver server', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('accepts POST /api/xdeliver and rejects missing fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'srv-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }],
    }));
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const srv = await startOrgServer(daemon, 0);
    close = srv.close;

    await daemon.startOrg('alpha');

    // missing fields → 400
    const bad = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toOrg: 'alpha' }),
    });
    expect(bad.status).toBe(400);

    // valid delivery → 200
    const good = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toOrg: 'alpha', toRole: 'boss', fromOrg: 'beta', fromRole: 'boss', subject: 'hi', body: 'hello' }),
    });
    expect(good.status).toBe(200);
    const data = await good.json() as { ok: boolean; receipt?: string };
    expect(data.ok).toBe(true);

    // unknown org → 404
    const miss = await fetch(`http://127.0.0.1:${srv.port}/api/xdeliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toOrg: 'nope', toRole: 'boss', fromOrg: 'beta', fromRole: 'boss', subject: 'hi', body: 'hello' }),
    });
    expect(miss.status).toBe(404);

    // unknown route → 404
    const notFound = await fetch(`http://127.0.0.1:${srv.port}/`);
    expect(notFound.status).toBe(404);

    await daemon.stopAll();
  });
});
