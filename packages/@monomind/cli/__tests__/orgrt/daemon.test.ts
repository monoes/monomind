// packages/@monomind/cli/__tests__/orgrt/daemon.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

  it('askHuman persists the question to questions.json and emits a question event', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-ask-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    const receipt = await d.askHuman('alpha', 'boss', 'ship it now or wait?');
    expect(receipt).toMatch(/question submitted|recorded/i);
    await d.stopAll();

    const questionEvents = running.busEvents().filter(e => e.type === 'question');
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0].from).toBe('boss');
    expect((questionEvents[0].data as any).question).toBe('ship it now or wait?');
    const questionId = (questionEvents[0].data as any).questionId as string;
    expect(questionId).toBeTruthy();

    const saved = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    expect(saved.questions).toHaveLength(1);
    expect(saved.questions[0]).toMatchObject({ questionId, role: 'boss', question: 'ship it now or wait?', answer: null, answeredAt: null });
  });

  it('answerQuestion delivers into a running role\'s live mailbox and marks the question answered', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-answer-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    await d.askHuman('alpha', 'coder', 'red or blue?');
    const saved = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    const questionId = saved.questions[0].questionId;

    const result = await d.answerQuestion('alpha', 'coder', questionId, 'blue');
    expect(result.ok).toBe(true);
    await new Promise(r => setTimeout(r, 50)); // let the echo session process the pushed mailbox message
    await d.stopAll();

    expect(running.busEvents().some(e => e.type === 'chat' && e.from === 'coder' && (e.msg ?? '').includes('blue'))).toBe(true);
    const savedAfter = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    expect(savedAfter.questions[0].answer).toBe('blue');
    expect(savedAfter.questions[0].answeredAt).toBeTypeOf('number');
  });

  it('answerQuestion queues the answer and auto-wakes an offline org', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-answer-offline-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    await d.askHuman('alpha', 'coder', 'red or blue?');
    const saved = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    const questionId = saved.questions[0].questionId;
    await d.stopOrg('alpha'); // org now offline

    const result = await d.answerQuestion('alpha', 'coder', questionId, 'blue');
    expect(result.ok).toBe(true);
    await new Promise(r => setTimeout(r, 100)); // let autoWake's startOrg + drainInbox + echo session settle
    const restarted = d.getOrg('alpha');
    expect(restarted).toBeDefined();
    expect(restarted!.busEvents().some(e => e.type === 'chat' && e.from === 'coder' && (e.msg ?? '').includes('blue'))).toBe(true);
    expect(restarted!.busEvents().some(e => e.type === 'chat' && e.from === 'coder' && (e.msg ?? '').includes('red or blue?'))).toBe(true);
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

describe('OrgDaemon — run history & cross-run memory', () => {
  it('appends a run summary to history.jsonl at stopOrg and briefs the next run\'s boss on it', async () => {
    const { existsSync } = await import('node:fs');
    const root = mkdtempSync(join(tmpdir(), 'daemon-hist-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });

    const run1 = await d.startOrg('alpha');
    // record an outcome the way the org_complete tool handler does
    run1.bus.emit({ type: 'status', from: 'boss', reason: 'org-complete', msg: 'run outcome: achieved', data: { outcome: 'achieved', summary: 'wrote the report' } });
    await d.stopOrg('alpha');

    const histFile = join(root, '.monomind/orgs/alpha/history.jsonl');
    expect(existsSync(histFile)).toBe(true);
    const hist = readFileSync(histFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(hist).toHaveLength(1);
    expect(hist[0].outcome).toMatchObject({ status: 'achieved', summary: 'wrote the report' });

    // second run: boss kickoff message must reference the previous outcome
    const run2 = await d.startOrg('alpha');
    await new Promise(r => setTimeout(r, 50)); // let the echo agent process the kickoff
    await d.stopOrg('alpha');
    const kickoffEcho = run2.busEvents().find(e => e.type === 'chat' && e.from === 'boss' && (e.msg ?? '').includes('Previous run'));
    expect(kickoffEcho).toBeDefined();
    expect(kickoffEcho!.msg).toContain('wrote the report');
  });

  it('restarts a transiently-crashing agent instead of leaving it dead (crash → restart → recover)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-restart-'));
    fixture(root, 'alpha');
    // fake SDK: coder's first session throws, later sessions echo normally
    let coderAttempts = 0;
    const flakyQuery = (opts: any) => {
      const isCoder = String(opts?.options?.systemPrompt ?? '').includes('"coder"');
      if (isCoder && coderAttempts++ === 0) {
        return (async function* () {
          for await (const _m of opts.prompt) throw new Error('transient blip');
        })();
      }
      return echoQuery(opts);
    };
    const d = new OrgDaemon(root, { queryFn: flakyQuery as any, forward: false, stopWaitMs: 100 });
    const running = await d.startOrg('alpha');
    await d.deliver('alpha', 'boss', 'coder', 'task', 'first'); // triggers the crash
    await new Promise(r => setTimeout(r, 1300)); // ride out the 1s backoff → restart
    const receipt = await d.deliver('alpha', 'boss', 'coder', 'task', 'second');
    expect(receipt).toMatch(/delivered/);
    await new Promise(r => setTimeout(r, 100));
    await d.stopOrg('alpha');

    const events = running.busEvents();
    expect(events.some(e => e.type === 'status' && e.reason === 'agent-restart' && e.from === 'coder')).toBe(true);
    // recovered: the restarted session echoed the second message
    expect(events.some(e => e.type === 'chat' && e.from === 'coder' && (e.msg ?? '').includes('second'))).toBe(true);
    expect(running.agents.get('coder')!.status).not.toBe('running');
  }, 20_000);
});
