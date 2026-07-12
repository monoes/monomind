// packages/@monomind/cli/__tests__/orgrt/forwarder.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { attachForwarder } from '../../src/orgrt/forwarder.js';

describe('attachForwarder', () => {
  let server: http.Server;
  afterEach(() => server?.close());

  it('POSTs each bus event to /api/mastermind/event, mapped to mastermind shape', async () => {
    const received: any[] = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => { received.push({ url: req.url, body: JSON.parse(body) }); res.end('{}'); });
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as any).port;

    // control.json points at our fake server
    const root = mkdtempSync(join(tmpdir(), 'fwd-'));
    writeFileSync(join(root, 'control.json'),
      JSON.stringify({ pid: 1, port, url: `http://127.0.0.1:${port}` }));

    const bus = new OrgBus('fwd-org', 'run-9', root);
    const done = attachForwarder(bus, join(root, 'control.json'));
    bus.emit({ type: 'message', from: 'boss', to: 'coder', msg: 'go', subject: 's' });
    await done.settle();

    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/api/mastermind/event');
    expect(received[0].body.type).toBe('org:message');
    expect(received[0].body.org).toBe('fwd-org');
    expect(received[0].body.msg).toBe('go');
  });

  it('is silent (no throw) when control server is down', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fwd2-'));
    writeFileSync(join(root, 'control.json'),
      JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1' }));
    const bus = new OrgBus('o', 'r', root);
    const done = attachForwarder(bus, join(root, 'control.json'));
    bus.emit({ type: 'status', msg: 'x' });
    await expect(done.settle()).resolves.toBeUndefined();
  });
});
