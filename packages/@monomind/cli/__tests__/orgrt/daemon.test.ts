// packages/@monomind/cli/__tests__/orgrt/daemon.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

// Module-level mock for resource-governor - used by U3 test
let resourcePressure = false;
let waitForCapacityCallCount = 0;

vi.mock('../../src/utils/resource-governor.js', () => ({
  checkResources: vi.fn(() => {
    const ok = !resourcePressure;
    return {
      ok,
      freeMemMB: ok ? 2000 : 100,
      freeMemPct: ok ? 80 : 5,
      sdkProcesses: 0,
      maxSdkProcesses: 10,
      reason: ok ? undefined : 'low memory: simulated pressure',
    };
  }),
  waitForCapacity: vi.fn(async () => {
    waitForCapacityCallCount++;
    const ok = !resourcePressure || waitForCapacityCallCount > 1; // Recovers on second call
    return {
      ok,
      freeMemMB: ok ? 2000 : 100,
      freeMemPct: ok ? 80 : 5,
      sdkProcesses: 0,
      maxSdkProcesses: 10,
      reason: ok ? undefined : 'low memory: simulated pressure',
    };
  }),
  getResourceLimits: vi.fn(() => ({ minFreeMemBytes: 0, maxSdkProcesses: 10, spawnStaggerMs: 0 })),
  configureResourceLimits: vi.fn(),
  reapOrphanedSdkProcesses: vi.fn(() => 0),
  getAvailableMemBytes: vi.fn(() => resourcePressure ? 100 * 1024 * 1024 : 2000 * 1024 * 1024),
}));

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

// Polls instead of a fixed sleep: startOrg()'s resource-governor check alone can
// take ~100ms (execSync vm_stat + pgrep), so a fixed short wait after autoWake()
// or a delivery is inherently fragile — poll for the actual condition instead.
async function waitUntil(pred: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 20));
  }
  return pred();
}

describe('OrgDaemon — per-role max_turns_per_message override', () => {
  it('uses a role\'s own max_turns_per_message when set, falling back to run_config for roles without one', async () => {
    // Regression (issue #25's still-valid ask): a global turn budget forces
    // every role onto the same cap even though e.g. a developer role legitimately
    // needs far more turns per message than a docs/pm role.
    const root = mkdtempSync(join(tmpdir(), 'daemon-maxturns-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      run_config: { max_turns_per_message: 30 },
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'developer', title: 'Developer', type: 'specialist', reports_to: 'boss', max_turns_per_message: 80 },
      ],
    }));

    const seenMaxTurns: Record<string, number> = {};
    const capturingQuery = ({ prompt, options }: any) => {
      const roleId = /You are agent "([^"]+)"/.exec(options.systemPrompt)?.[1] ?? 'unknown';
      seenMaxTurns[roleId] = options.maxTurns;
      return echoQuery({ prompt, options });
    };

    const d = new OrgDaemon(root, { queryFn: capturingQuery as any, forward: false });
    await d.startOrg('alpha');
    // Only the boss spawns at boot now; non-boss roles are lazy. Address the
    // developer so it spawns — the assertion is about which maxTurns its
    // query() receives, which cannot be observed until the session exists.
    await d.deliver('alpha', 'boss', 'developer', 'wake', 'spawn for the assertion below');
    await d.stopAll();

    expect(seenMaxTurns.boss).toBe(30); // falls back to run_config default
    expect(seenMaxTurns.developer).toBe(80); // per-role override wins
  });
});

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
    // autoWake's startOrg + drainInbox + echo session settling — the resource-governor
    // check alone can take ~100ms, so poll rather than assume a fixed delay is enough.
    await waitUntil(() => (d.getOrg('alpha')?.busEvents() ?? [])
      .some(e => e.type === 'chat' && e.from === 'coder' && (e.msg ?? '').includes('blue')));
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

  it('deliver() queues to inbox (not a false "delivered", not dropped) when the target mailbox closes but the org is alive', async () => {
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
    // The org is alive (only the coder's session ended from budget), so the
    // message must be queued to the inbox for a later drain — not dropped
    // with a "shutting down" error, and not falsely reported as delivered.
    expect(receipt).toMatch(/queued to inbox/);
    expect(receipt).not.toMatch(/shutting down/);
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

  it('#114: startOrg joins an in-flight stopOrg for the same name instead of racing its drain/worktree cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon9-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false, stopWaitMs: 150 });
    const first = await d.startOrg('alpha');
    const firstRun = first.run;

    // Kick off stopOrg but don't await it yet — its drain window is still open.
    const stopPromise = d.stopOrg('alpha');

    // A start racing that in-flight stop must wait for it to finish rather than
    // throwing "already running" (this.orgs still has the entry mid-drain) or
    // colliding on the shared worktree path being torn down.
    const second = await d.startOrg('alpha');
    await stopPromise;

    expect(second.run).not.toBe(firstRun);
    await d.stopOrg('alpha');
  });
});

describe('OrgDaemon — completion & idle watchdog', () => {
  it('self-stops the org after an org-complete event (run does not sit "running" forever)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-selfstop-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    running.bus.emit({ type: 'status', from: 'boss', reason: 'org-complete', msg: 'run outcome: achieved', data: { outcome: 'achieved', summary: 'done' } });
    // self-stop is deferred ~1s so the boss's final turn can land — poll for it
    const deadline = Date.now() + 5000;
    while (d.getOrg('alpha') && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    expect(d.getOrg('alpha')).toBeUndefined();
    // mirrors `org run`: stopAll() must JOIN the detached in-flight self-stop,
    // not no-op, so the process can't exit before history/runtime.json land
    await d.stopAll();
    expect(running.busEvents().some(e => e.type === 'status' && e.msg === 'org stopped')).toBe(true);
    const rt = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/runtime.json'), 'utf8'));
    expect(rt.status).toBe('stopped');
  }, 10_000);

  it('idle watchdog nudges the boss, then stops the org when the nudge produces no activity (hung agent)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-idle-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      run_config: { idle_minutes: 0.005 }, // 300ms idle window for the test
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
      ],
    }));
    // sessions that never process their mailbox — simulates every agent wedged on a hung tool call
    const hangingQuery = () => (async function* () { await new Promise(() => {}); })();
    const d = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false, stopWaitMs: 200 });
    const running = await d.startOrg('alpha');
    const deadline = Date.now() + 8000;
    while (d.getOrg('alpha') && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    const events = running.busEvents();
    expect(events.some(e => e.type === 'audit' && e.reason === 'idle-nudge')).toBe(true);
    expect(events.some(e => e.type === 'audit' && e.reason === 'idle-stop')).toBe(true);
    expect(d.getOrg('alpha')).toBeUndefined();
  }, 15_000);

  it('idle watchdog stays quiet while there is bus activity, and idle_minutes: 0 disables it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-idle-off-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      run_config: { idle_minutes: 0 },
      roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
    }));
    const hangingQuery = () => (async function* () { await new Promise(() => {}); })();
    const d = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false, stopWaitMs: 200 });
    const running = await d.startOrg('alpha');
    await new Promise(r => setTimeout(r, 1200)); // several would-be idle windows
    expect(d.getOrg('alpha')).toBeDefined(); // still running — watchdog disabled
    await d.stopOrg('alpha');
    expect(running.busEvents().some(e => e.reason === 'idle-nudge' || e.reason === 'idle-stop')).toBe(false);
  }, 10_000);
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

describe('OrgDaemon — cross-run org memory (org_recall store side)', () => {
  it('persists the run outcome into the org memory store when the root passes the bridge path guard', async () => {
    // Root must be inside cwd — the memory bridge's traversal guard rejects
    // out-of-tree paths (and the daemon must then skip org memory entirely).
    const root = mkdtempSync(join(process.cwd(), '.tmp-orgmem-'));
    try {
      fixture(root, 'alpha');
      const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
      const run1 = await d.startOrg('alpha');
      run1.bus.emit({ type: 'status', from: 'boss', reason: 'org-complete', msg: 'run outcome: achieved', data: { outcome: 'achieved', summary: 'published the pricing report' } });
      await d.stopOrg('alpha');

      const { bridgeSearchEntries } = await import('../../src/memory/memory-bridge.js');
      const res = await bridgeSearchEntries({
        query: 'pricing report outcome',
        namespace: 'org:alpha',
        dbPath: join(root, '.monomind', 'org-memory'),
        limit: 5,
      });
      const contents = (res?.results ?? []).map(r => r.content).join('\n');
      expect(contents).toContain('published the pricing report');
      expect(contents).toContain('achieved');
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('skips org memory (no misrouted writes) when the org root is outside the guard-allowed trees', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-orgmem-'));
    try {
      fixture(root, 'alpha');
      const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
      const run1 = await d.startOrg('alpha');
      run1.bus.emit({ type: 'status', from: 'boss', reason: 'org-complete', msg: 'x', data: { outcome: 'achieved', summary: 'should not be stored' } });
      await d.stopOrg('alpha');
      const { existsSync } = await import('node:fs');
      expect(existsSync(join(root, '.monomind', 'org-memory', 'memory.db'))).toBe(false);
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('OrgDaemon — P1 critical paths (Batch 2)', () => {
  describe('scheduleDeferredSpawn resource recovery', () => {
    beforeEach(() => {
      resourcePressure = false;
      waitForCapacityCallCount = 0;
    });

    afterEach(() => {
      resourcePressure = false;
      waitForCapacityCallCount = 0;
    });

    it('U3: drains inbox BEFORE spawnRole and delivers queued messages after recovery', async () => {
      // Test for B5 race condition fix: queueMessage must happen before scheduleDeferredSpawn
      // This test verifies the full recovery flow: resource pressure → queue → wait → recover → deliver
      const root = mkdtempSync(join(tmpdir(), 'daemon-recovery-'));
      try {
        fixture(root, 'alpha');
        const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });

        // Enable resource pressure simulation
        resourcePressure = true;
        waitForCapacityCallCount = 0;

        const running = await d.startOrg('alpha');

        // Trigger lazy spawn while under pressure - should queue message
        const receipt = await d.deliver('alpha', 'boss', 'coder', 'task', 'do this while recovering');
        expect(receipt).toMatch(/queued for.*coder.*role starting.*waiting for resources/);

        // Wait for recovery and message delivery
        await waitUntil(() => running.busEvents().some(e => e.reason === 'resource-recovered'), 3000);

        // Verify resource-recovered audit event was emitted
        const recoveredEvents = running.busEvents().filter(e => e.reason === 'resource-recovered');
        expect(recoveredEvents.length).toBeGreaterThan(0);
        expect(recoveredEvents[0].from).toBe('coder');

        // Verify queued message was delivered after spawn
        await waitUntil(() => running.busEvents().some(e => e.type === 'chat' && e.from === 'coder'), 2000);
        const chatEvents = running.busEvents().filter(e => e.type === 'chat' && e.from === 'coder');
        expect(chatEvents.length).toBeGreaterThan(0);

        await d.stopAll();
      } finally {
        resourcePressure = false;
        waitForCapacityCallCount = 0;
        const { rmSync } = await import('node:fs');
        rmSync(root, { recursive: true, force: true });
      }
    }, 30_000);
  });

  describe('replayFrom time-travel debugging', () => {
    it('U4: recreates org state from checkpoint and re-emits events with new timestamps', async () => {
      // Test time-travel debugging: replay from existing run directory
      const root = mkdtempSync(join(tmpdir(), 'daemon-replay-'));
      try {
        fixture(root, 'alpha');
        const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });

        // Create an original run with some events
        const original = await d.startOrg('alpha');
        await d.deliver('alpha', 'boss', 'coder', 'task', 'original task');
        await new Promise(r => setTimeout(r, 100)); // let events settle
        await d.stopOrg('alpha');

        const originalRun = original.run;
        const originalEvents = original.busEvents();
        expect(originalEvents.length).toBeGreaterThan(0);

        // Replay from the checkpoint
        const replay = await d.replayFrom('alpha', originalRun);
        expect(replay).not.toBeNull();
        expect(replay!.run).toMatch(/^replay-\d{14}-[a-z0-9]{4}$/);

        // Verify replay bus has events
        const replayEvents = replay!.busEvents();
        expect(replayEvents.length).toBeGreaterThan(0);

        // Verify replay emits a status event indicating replay started
        const replayStatus = replayEvents.filter(e => e.type === 'status' && e.msg?.includes('replay started'));
        expect(replayStatus.length).toBeGreaterThan(0);
        expect(replayStatus[0].msg).toContain(originalRun);
        expect(replayStatus[0].msg).toContain(`${originalEvents.length} events replayed`);

        // Verify replay has different run ID and timestamps
        expect(replay!.run).not.toBe(originalRun);

        await d.stopAll();
      } finally {
        const { rmSync } = await import('node:fs');
        rmSync(root, { recursive: true, force: true });
      }
    }, 20_000);

    it('U4: returns null when run directory does not exist', async () => {
      const root = mkdtempSync(join(tmpdir(), 'daemon-replay-missing-'));
      try {
        fixture(root, 'alpha');
        const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });

        const result = await d.replayFrom('alpha', 'nonexistent-run');
        expect(result).toBeNull();

        await d.stopAll();
      } finally {
        const { rmSync } = await import('node:fs');
        rmSync(root, { recursive: true, force: true });
      }
    }, 10_000);
  });

  describe('Approval queue persistence (B6 visibility path)', () => {
    it('U6: checkApproval queues sensitive actions, persists to approvals.json, and setApproval resolves', async () => {
      // Test approval gate for sensitive actions (Bash, WebFetch, WebSearch, org_complete)
      const root = mkdtempSync(join(tmpdir(), 'daemon-approval-'));
      try {
        fixture(root, 'alpha');
        const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });

        const running = await d.startOrg('alpha');

        // Request approval for sensitive action (Bash)
        const approvalResult = await d['checkApproval']('alpha', 'coder', 'Bash');
        expect(approvalResult).toBeNull(); // Pending human approval

        // Verify persisted to approvals.json
        const { readFileSync } = await import('node:fs');
        const approvalsPath = join(root, '.monomind/orgs/alpha/approvals.json');
        expect(readFileSync(approvalsPath, 'utf8')).toBeTruthy();

        const approvalsData = JSON.parse(readFileSync(approvalsPath, 'utf8'));
        expect(approvalsData.approvals).toHaveLength(1);
        expect(approvalsData.approvals[0]).toMatchObject({
          roleId: 'coder',
          question: 'Approve Bash tool call?',
          approved: null,
        });

        // Verify question event was emitted
        const questionEvents = running.busEvents().filter(e => e.type === 'question' && e.data?.action === 'Bash');
        expect(questionEvents.length).toBeGreaterThan(0);
        expect(questionEvents[0].data?.question).toContain('Approval required for Bash');

        // Grant approval
        const setApprovalResult = await d.setApproval('alpha', 'coder', 'Bash', true);
        expect(setApprovalResult.ok).toBe(true);

        // Verify approvals.json updated
        const approvalsAfter = JSON.parse(readFileSync(approvalsPath, 'utf8'));
        expect(approvalsAfter.approvals[0].approved).toBe(true);

        // Verify status event was emitted
        const statusEvents = running.busEvents().filter(e => e.type === 'status' && e.msg?.includes('Approval granted'));
        expect(statusEvents.length).toBeGreaterThan(0);

        // Verify calling checkApproval again returns the approved decision
        const cachedApproval = await d['checkApproval']('alpha', 'coder', 'Bash');
        expect(cachedApproval).toBe(true); // Auto-approved from cache

        await d.stopAll();
      } finally {
        const { rmSync } = await import('node:fs');
        rmSync(root, { recursive: true, force: true });
      }
    }, 20_000);

    it('U6: auto-approves non-sensitive actions without persisting', async () => {
      const root = mkdtempSync(join(tmpdir(), 'daemon-auto-approve-'));
      try {
        fixture(root, 'alpha');
        const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });

        const running = await d.startOrg('alpha');

        // Non-sensitive action should be auto-approved
        const approvalResult = await d['checkApproval']('alpha', 'coder', 'Read');
        expect(approvalResult).toBe(true); // Auto-approved

        // Verify no approvals.json was created
        const { existsSync } = await import('node:fs');
        const approvalsPath = join(root, '.monomind/orgs/alpha/approvals.json');
        expect(existsSync(approvalsPath)).toBe(false);

        // Verify no question event was emitted
        const questionEvents = running.busEvents().filter(e => e.type === 'question');
        expect(questionEvents.length).toBe(0);

        await d.stopAll();
      } finally {
        const { rmSync } = await import('node:fs');
        rmSync(root, { recursive: true, force: true });
      }
    }, 10_000);
  });

  describe('OrgDaemon — parentId threading', () => {
    it('tracks lastMessageId on message delivery', async () => {
      const root = mkdtempSync(join(tmpdir(), 'daemon-parent-'));
      try {
        fixture(root, 'alpha');
        const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
        const running = await d.startOrg('alpha');

        // Send a message to the coder (triggers lazy spawn)
        await d.deliver('alpha', 'boss', 'coder', 'task', 'first message');

        // Wait for agent to be ready
        await waitUntil(() => {
          const org = d['orgs'].get('alpha');
          return org?.agents.has('coder') ?? false;
        });

        const org = d['orgs'].get('alpha');
        const agent = org?.agents.get('coder');

        // Verify lastMessageId was tracked
        expect(agent?.lastMessageId).toBeDefined();
        expect(typeof agent?.lastMessageId).toBe('string');

        await d.stopAll();
      } finally {
        const { rmSync } = await import('node:fs');
        rmSync(root, { recursive: true, force: true });
      }
    }, 10_000);

    it('emits chat events with parentId linking to triggering message', async () => {
      const root = mkdtempSync(join(tmpdir(), 'daemon-thread-'));
      try {
        fixture(root, 'alpha');
        const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
        const running = await d.startOrg('alpha');

        // Wait for lazy spawn to complete
        await d.deliver('alpha', 'boss', 'coder', 'task', 'first');
        await waitUntil(() => {
          const org = d['orgs'].get('alpha');
          return org?.agents.has('coder') ?? false;
        });

        // Clear previous events
        const beforeEvents = running.busEvents();

        // Send a message that will generate a response
        await d.deliver('alpha', 'boss', 'coder', 'task', 'respond to this');

        // Wait for message processing and response
        await new Promise(resolve => setTimeout(resolve, 300));

        const allEvents = running.busEvents();
        // Only look at events after our baseline
        const events = allEvents.slice(beforeEvents.length);

        // Find the message event (look for the message we just sent)
        const messageEvents = events.filter(e => e.type === 'message' && e.msg?.includes('respond to this'));
        expect(messageEvents.length).toBeGreaterThan(0);
        const messageEvent = messageEvents[0];

        // Find the chat response event
        const chatEvents = events.filter(e => e.type === 'chat' && e.from === 'coder');
        expect(chatEvents.length).toBeGreaterThan(0);
        const chatEvent = chatEvents[0];

        // Verify chat event has parentId that matches the message ID
        expect(chatEvent.parentId).toBe(messageEvent.id);

        await d.stopAll();
      } finally {
        const { rmSync } = await import('node:fs');
        rmSync(root, { recursive: true, force: true });
      }
    }, 10_000);

    it('updates lastMessageId on each new message', async () => {
      const root = mkdtempSync(join(tmpdir(), 'daemon-multi-'));
      try {
        fixture(root, 'alpha');
        const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
        const running = await d.startOrg('alpha');

        // Wait for lazy spawn to complete
        await d.deliver('alpha', 'boss', 'coder', 'task', 'first');
        await waitUntil(() => {
          const org = d['orgs'].get('alpha');
          return org?.agents.has('coder') ?? false;
        });

        const org = d['orgs'].get('alpha');
        const agent = org?.agents.get('coder');

        const firstId = agent?.lastMessageId;
        expect(firstId).toBeDefined();

        // Send second message
        await d.deliver('alpha', 'boss', 'coder', 'task', 'second');

        // Wait for message processing
        await new Promise(resolve => setTimeout(resolve, 100));

        const secondId = agent?.lastMessageId;
        expect(secondId).toBeDefined();
        expect(secondId).not.toBe(firstId); // Should be updated to new message ID

        await d.stopAll();
      } finally {
        const { rmSync } = await import('node:fs');
        rmSync(root, { recursive: true, force: true });
      }
    }, 10_000);

    it('maintains conversation chain across multiple turns', async () => {
      const root = mkdtempSync(join(tmpdir(), 'daemon-chain-'));
      try {
        fixture(root, 'alpha');
        const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
        const running = await d.startOrg('alpha');

        // Wait for lazy spawn to complete
        await d.deliver('alpha', 'boss', 'coder', 'task', 'spawn');
        await waitUntil(() => {
          const org = d['orgs'].get('alpha');
          return org?.agents.has('coder') ?? false;
        });

        // Clear previous events
        const baseline = running.busEvents();

        // Send first message
        await d.deliver('alpha', 'boss', 'coder', 'task', 'first message');
        await new Promise(resolve => setTimeout(resolve, 300));

        const events1 = running.busEvents().slice(baseline.length);
        const firstMessage = events1.find(e => e.type === 'message' && e.msg?.includes('first message'));
        const firstResponse = events1.find(e => e.type === 'chat' && e.parentId === firstMessage?.id);

        expect(firstResponse?.parentId).toBe(firstMessage?.id);

        // Send second message (continuing the conversation)
        await d.deliver('alpha', 'boss', 'coder', 'task', 'second message');
        await new Promise(resolve => setTimeout(resolve, 300));

        const events2 = running.busEvents().slice(events1.length + baseline.length);
        const secondMessage = events2.find(e => e.type === 'message' && e.msg?.includes('second message'));
        const secondResponse = events2.find(e => e.type === 'chat' && e.parentId === secondMessage?.id);

        expect(secondResponse?.parentId).toBe(secondMessage?.id);
        expect(secondMessage?.id).not.toBe(firstMessage?.id); // Different message IDs

        await d.stopAll();
      } finally {
        const { rmSync } = await import('node:fs');
        rmSync(root, { recursive: true, force: true });
      }
    }, 15_000);
  });
});

describe('OrgDaemon — crash recovery (worker notify, context-limit, boss auto-restart)', () => {
  // shared fake: the "coder" role throws on the first .next() WITHOUT consuming a
  // message, so every crash-retry re-throws and the role reaches a terminal crash
  // (consuming the only message would make later retries block on an empty mailbox
  // and never crash). The boss stays alive and echoes every message it's told.
  function crashingWorkerQuery(workerErr: string, bossEcho: string[] = []) {
    return ({ prompt, options }: any) => (async function* () {
      if (/agent "coder"/.test(options.systemPrompt ?? '')) throw new Error(workerErr);
      for await (const m of prompt) {
        bossEcho.push(m.message.content);
        yield { type: 'assistant', message: { content: [{ type: 'text', text: m.message.content }] } };
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();
  }

  it('notifies the boss when a worker terminally crashes so it can reassign (#2)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-cr2-'));
    fixture(root, 'alpha');
    const bossEcho: string[] = [];
    const d = new OrgDaemon(root, { queryFn: crashingWorkerQuery('simulated provider outage: 500', bossEcho) as any, forward: false, crashBackoffsMs: [10, 10, 10] });
    const running = await d.startOrg('alpha');
    const audits: any[] = [];
    running.bus.subscribe(e => { if (e.type === 'audit') audits.push(e); });

    await d.deliver('alpha', 'boss', 'coder', 'task', 'build it');
    await waitUntil(() => running.agents.get('coder')?.status === 'crashed', 3000);
    await new Promise(r => setTimeout(r, 80)); // let the alive boss echo the notice

    expect(running.agents.get('coder')!.status).toBe('crashed');
    // boss was told the worker is gone (audit) and actually received a system message (echo)
    expect(audits.some(a => a.reason === 'worker-crashed')).toBe(true);
    expect(bossEcho.some(c => /Worker "coder" crashed/.test(c))).toBe(true);
    await d.stopOrg('alpha');
  }, 10_000);

  it('tells the boss to chunk smaller when a worker crashes on a context-window limit (#3)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-cr3-'));
    fixture(root, 'alpha');
    const bossEcho: string[] = [];
    const d = new OrgDaemon(root, { queryFn: crashingWorkerQuery('The model has reached its context window limit.', bossEcho) as any, forward: false, crashBackoffsMs: [10, 10, 10] });
    const running = await d.startOrg('alpha');
    const audits: any[] = [];
    running.bus.subscribe(e => { if (e.type === 'audit') audits.push(e); });

    await d.deliver('alpha', 'boss', 'coder', 'task', 'build it');
    await waitUntil(() => running.agents.get('coder')?.status === 'crashed', 3000);
    await new Promise(r => setTimeout(r, 80));

    // distinct audit reason for context-limit vs generic crash
    expect(audits.some(a => a.reason === 'agent-context-limit' && a.from === 'coder')).toBe(true);
    // boss guidance includes the chunking instruction, not just the generic reassign note
    expect(bossEcho.some(c => /context-window overflow/.test(c) && /smaller pieces/.test(c))).toBe(true);
    await d.stopOrg('alpha');
  }, 10_000);

  it('bounded auto-restart: a repeatedly crashing boss restarts at most MAX times then stops (#4)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-cr4-'));
    fixture(root, 'alpha');
    // every role throws on the first .next() without consuming — the boss dies on
    // every (re)start, so it exercises the auto-restart path repeatedly.
    const alwaysDie = () => (async function* () { throw new Error('boss always dies'); })();
    const d = new OrgDaemon(root, { queryFn: alwaysDie as any, forward: false, crashBackoffsMs: [10, 10, 10], bossRestartBackoffMs: [10, 10] });
    const startSpy = vi.spyOn(d, 'startOrg' as any);
    await d.startOrg('alpha');

    // Wait for restarts to settle: no new startOrg call for 400ms means the cap
    // was hit and the daemon gave up (proving it does NOT loop forever).
    let prev = -1, stableAt = Date.now();
    while (Date.now() - stableAt < 6000) {
      const c = startSpy.mock.calls.length;
      if (c !== prev) { prev = c; stableAt = Date.now(); }
      else if (Date.now() - stableAt > 400) break;
      await new Promise(r => setTimeout(r, 40));
    }
    // 1 initial start + at most MAX_BOSS_RESTARTS (2) auto-restarts.
    expect(startSpy.mock.calls.length).toBeLessThanOrEqual(3);
    await d.stopOrg('alpha');
  }, 15_000);
});

describe('OrgDaemon — oversized mailbox digest', () => {
  it('digests bodies over 4KB to <workdir>/.mail/<id>.md; smaller bodies stay byte-identical', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-maildigest-'));
    try {
      fixture(root, 'alpha');
      const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
      const running = await d.startOrg('alpha');
      const coderChat = (needle: string) =>
        running.busEvents().find(e => e.type === 'chat' && e.from === 'coder' && (e.msg ?? '').includes(needle))?.msg ?? '';

      // Over the boundary: full text goes to disk, mailbox gets a digest.
      const big = `HEAD ${'B'.repeat(5000)} TAIL`;
      await d.deliver('alpha', 'boss', 'coder', 'big', big);
      expect(await waitUntil(() => coderChat('full text at') !== '')).toBe(true);
      const digestEcho = coderChat('full text at');
      expect(digestEcho).toContain('[message from boss] subject: big');
      expect(digestEcho).toContain('HEAD ');
      expect(digestEcho).not.toContain('TAIL');
      const { readdirSync, rmSync } = await import('node:fs');
      const mailDir = join(root, '.mail');
      const files = readdirSync(mailDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^[a-zA-Z0-9_-]+\.md$/);
      expect(readFileSync(join(mailDir, files[0]), 'utf8')).toBe(big);

      // At the boundary (exactly 4KB): no digest, byte-identical delivery.
      const exact = 'C'.repeat(4096);
      await d.deliver('alpha', 'boss', 'coder', 'exact', exact);
      expect(await waitUntil(() => coderChat(`subject: exact\n\n${exact}`) !== '')).toBe(true);

      // Small message: byte-identical delivery, no extra .mail file.
      await d.deliver('alpha', 'boss', 'coder', 'small', 'hello');
      expect(await waitUntil(() => coderChat('echo: [message from boss] subject: small\n\nhello') !== '')).toBe(true);
      expect(readdirSync(mailDir).length).toBe(1);

      await d.stopOrg('alpha');
      rmSync(root, { recursive: true, force: true });
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
