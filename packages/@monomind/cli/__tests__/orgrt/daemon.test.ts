// packages/@monomind/cli/__tests__/orgrt/daemon.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { OrgDaemon } from '../../src/orgrt/daemon.js';

function fixture(root: string, name: string) {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs', `${name}.json`), JSON.stringify({
    name, goal: `goal of ${name}`,
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
    ],
  }));
}

// fake SDK: each session echoes every incoming mailbox message as one assistant turn
const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

describe('OrgDaemon', () => {
  it('stopOrg waits for the forwarder\'s final POST (org:complete/session:complete) before returning', async () => {
    // Regression: stopOrg used to resolve as soon as bus.flush() (local disk write)
    // finished, without waiting for the forwarder's in-flight HTTP POST triggered by
    // the "org stopped" bus event. A caller that exits the process right after
    // stopOrg() (exactly what `monomind org run` does) could kill that POST mid-flight,
    // leaving the dashboard's session permanently stuck showing "running".
    const root = mkdtempSync(join(tmpdir(), 'daemon-fwd-'));
    fixture(root, 'alpha');
    const received: any[] = [];
    let delayNextResponse = false;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const payload = JSON.parse(body);
        received.push(payload);
        const respond = () => res.end('{}');
        if (delayNextResponse) setTimeout(respond, 100); else respond();
      });
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as any).port;
    writeFileSync(join(root, 'control.json'), JSON.stringify({ pid: 1, port, url: `http://127.0.0.1:${port}` }));

    const d = new OrgDaemon(root, { queryFn: echoQuery as any, controlJson: join(root, 'control.json') });
    await d.startOrg('alpha');
    delayNextResponse = true; // simulate a slow dashboard — the race stopOrg must survive
    await d.stopOrg('alpha');
    server.close();

    expect(received.map(r => r.type)).toContain('session:complete');
    expect(received.map(r => r.type)).toContain('org:complete');
  });

  it('starts an org, seeds the boss with the goal, routes intra-org messages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    expect(running.run).toMatch(/^run-\d{14}-[a-z0-9]{4}$/); // stamp + anti-collision suffix, no trailing dot
    const receipt = await d.deliver('alpha', 'boss', 'coder', 'task', 'build it');
    expect(receipt).toMatch(/delivered/);
    await d.stopOrg('alpha');
    const types = running.busEvents().map(e => e.type);
    expect(types).toContain('message');   // boss→coder recorded
    expect(types).toContain('chat');      // echo agent replied
    expect(types).toContain('status');
  });

  it('routes inter-org messages and emits xorg on both buses', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon2-'));
    fixture(root, 'alpha'); fixture(root, 'beta');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const a = await d.startOrg('alpha');
    const b = await d.startOrg('beta');
    await d.deliver('alpha', 'boss', 'beta:boss', 'handoff', 'please review');
    await d.stopAll();
    expect(a.busEvents().some(e => e.type === 'xorg' && e.to === 'beta:boss')).toBe(true);
    expect(b.busEvents().some(e => e.type === 'xorg' && e.from === 'alpha:boss')).toBe(true);
  });

  it('treats "own-org:role" addressing as intra-org message, not xorg', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon4-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const a = await d.startOrg('alpha');
    const receipt = await d.deliver('alpha', 'boss', 'alpha:coder', 's', 'b');
    expect(receipt).toMatch(/delivered/);
    await d.stopAll();
    expect(a.busEvents().some(e => e.type === 'message' && e.to === 'coder')).toBe(true);
    expect(a.busEvents().some(e => e.type === 'xorg')).toBe(false);
  });

  it('rejects delivery to unknown role with a useful receipt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon3-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    await d.startOrg('alpha');
    const receipt = await d.deliver('alpha', 'boss', 'nobody', 's', 'b');
    expect(receipt).toMatch(/unknown recipient/);
    await d.stopAll();
  });

  it('marks an agent crashed and emits an audit event when its session rejects (P2-50)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon5-'));
    fixture(root, 'alpha');
    // fake SDK: the "coder" role throws immediately (simulates bad API key / provider outage);
    // "boss" behaves normally so we can prove only the crashed agent is affected.
    const crashingQuery = ({ prompt }: any) => (async function* () {
      for await (const _m of prompt) {
        throw new Error('simulated provider outage: 401 invalid api key');
      }
    })();
    const d = new OrgDaemon(root, { queryFn: crashingQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    // nudge the coder's mailbox so its session actually runs and throws
    await d.deliver('alpha', 'boss', 'coder', 'task', 'build it');
    await d.stopOrg('alpha');

    const coder = running.agents.get('coder')!;
    expect(coder.status).toBe('crashed');
    expect(coder.error).toMatch(/simulated provider outage/);

    const audit = running.busEvents().find(
      e => e.type === 'audit' && e.reason === 'agent-session-crash' && e.from === 'coder',
    );
    expect(audit).toBeDefined();
    expect(audit!.msg).toMatch(/simulated provider outage/);
  });

  it('deliver() reports a real error (not a false "delivered") when the target mailbox is already closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon6-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', policy: { maxTokens: 1 } },
      ],
    }));
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    await d.startOrg('alpha');
    // first message exhausts coder's 1-token budget, closing its mailbox (session.ts's overBudget check)
    await d.deliver('alpha', 'boss', 'coder', 'first', 'go');
    await new Promise(r => setTimeout(r, 100)); // let the async session process it and close its mailbox
    const receipt = await d.deliver('alpha', 'boss', 'coder', 'second', 'still there?');
    expect(receipt).toMatch(/shutting down|not delivered/);
    await d.stopAll();
  });

  it('stopOrg is reentrant-safe: a concurrent second call no-ops instead of double-emitting completion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon7-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    await Promise.all([d.stopOrg('alpha'), d.stopOrg('alpha')]);
    const stoppedCount = running.busEvents().filter(e => e.type === 'status' && e.msg === 'org stopped').length;
    expect(stoppedCount).toBe(1);
  });

  it('stopOrg does not hang forever on a truly wedged agent session (bounded stop wait)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon8-'));
    fixture(root, 'alpha');
    // ignores mailbox input entirely and never resolves — simulates a session stuck mid-tool-call
    const hangingQuery = () => (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'stuck' }] } };
      await new Promise(() => {});
    })();
    const d = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false, stopWaitMs: 200 });
    const running = await d.startOrg('alpha');
    const start = Date.now();
    await d.stopOrg('alpha');
    expect(Date.now() - start).toBeLessThan(2000);
    expect(running.busEvents().some(e => e.type === 'audit' && e.reason === 'stop-timeout')).toBe(true);
  });
});
