// packages/@monomind/cli/__tests__/orgrt/forwarder.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { attachForwarder, translate, companionEvents } from '../../src/orgrt/forwarder.js';
import type { BusEvent } from '../../src/orgrt/types.js';

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
    // dashboard-native shape: Chat tab renders org:comms; run routing needs org+runId
    expect(received[0].body.type).toBe('org:comms');
    expect(received[0].body.org).toBe('fwd-org');
    expect(received[0].body.runId).toBe('run-9');
    expect(received[0].body.from).toBe('boss');
    expect(received[0].body.to).toBe('coder');
    expect(received[0].body.msg).toBe('[s] go');
  });

  it('translates every bus event kind into the dashboard vocabulary', () => {
    const mk = (p: Partial<BusEvent>): BusEvent =>
      ({ id: '1', ts: 5, org: 'o', run: 'r', type: 'status', ...p } as BusEvent);

    expect(translate(mk({ type: 'chat', from: 'boss', msg: 'hi' })))
      .toMatchObject({ type: 'org:comms', from: 'boss', to: 'all', msg: 'hi', org: 'o', runId: 'r' });
    expect(translate(mk({ type: 'xorg', from: 'o:boss', to: 'p:boss', subject: 'fyi', msg: 'x' })))
      .toMatchObject({ type: 'org:comms', to: 'p:boss', msg: '[fyi] x' });
    expect(translate(mk({ type: 'asset', from: 'coder', path: '/w/out/report.md' })))
      .toMatchObject({ type: 'org:artifact', artifact: { label: 'report.md', path: '/w/out/report.md' } });
    expect(translate(mk({ type: 'asset', from: 'coder', path: '/w/out/report.md', data: { content: '# v2' } })))
      .toMatchObject({ type: 'org:artifact', artifact: { label: 'report.md', content: '# v2' } });
    expect(translate(mk({ msg: 'org started (2 agents)', data: { goal: 'g' } })))
      .toMatchObject({ type: 'org:start', goal: 'g' });
    expect(translate(mk({ msg: 'org stopped' }))).toMatchObject({ type: 'org:complete' });
    expect(translate(mk({ msg: 'session starting', from: 'coder' })))
      .toMatchObject({ type: 'org:agent:online', role: 'coder' });
    expect(translate(mk({ msg: 'session ended', from: 'coder' })))
      .toMatchObject({ type: 'org:agent:offline', from: 'coder' });
    expect(translate(mk({ msg: 'token budget exhausted — closing session', from: 'coder' })))
      .toMatchObject({ type: 'org:checkpoint', progress: expect.stringContaining('budget') });
    expect(translate(mk({ type: 'tool', from: 'coder', tool: 'Bash', decision: 'deny' })))
      .toMatchObject({ type: 'org:tool', decision: 'deny', runId: 'r' });
    expect(translate(mk({ type: 'usage', from: 'boss', data: { tokens: 5 } })))
      .toMatchObject({ type: 'org:usage' });
  });

  it('emits session:start BEFORE org:start so the dashboard session record exists first', async () => {
    // dist/src/ui/orgs.html only adds a run to chatSessions on session:start;
    // every later event (including org:start itself) is dropped client-side
    // if that record doesn't exist yet — order is load-bearing, not cosmetic.
    const received: any[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => { received.push(JSON.parse(body)); res.end('{}'); });
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as any).port;
    const root = mkdtempSync(join(tmpdir(), 'fwd3-'));
    writeFileSync(join(root, 'control.json'), JSON.stringify({ pid: 1, port, url: `http://127.0.0.1:${port}` }));

    const bus = new OrgBus('fwd-org', 'run-1', root);
    const done = attachForwarder(bus, join(root, 'control.json'));
    bus.emit({ type: 'status', msg: 'org started (1 agents)', data: { goal: 'ship it' } });
    await done.settle();
    server.close();

    expect(received.map(r => r.type)).toEqual(['session:start', 'org:start']);
    expect(received[0]).toMatchObject({ session: 'fwd-org__run-1', org: 'fwd-org', prompt: 'ship it' });
  });

  it('companionEvents: only status "org started"/"org stopped" produce session events; everything else is empty', () => {
    const mk = (p: Partial<BusEvent>): BusEvent =>
      ({ id: '1', ts: 5, org: 'o', run: 'r', type: 'status', ...p } as BusEvent);

    expect(companionEvents(mk({ msg: 'org started (2 agents)', data: { goal: 'g' } })))
      .toEqual([{ session: 'o__r', org: 'o', ts: 5, type: 'session:start', prompt: 'g' }]);
    expect(companionEvents(mk({ msg: 'org started (2 agents)' })))
      .toMatchObject([{ type: 'session:start', prompt: 'o' }]); // falls back to org name if goal missing
    expect(companionEvents(mk({ msg: 'org stopped' })))
      .toEqual([{ session: 'o__r', org: 'o', ts: 5, type: 'session:complete', status: 'complete', domains: ['ops'] }]);
    expect(companionEvents(mk({ msg: 'session starting' }))).toEqual([]);
    expect(companionEvents(mk({ type: 'chat', msg: 'hi' }))).toEqual([]);
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
