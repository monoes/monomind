// packages/@monomind/cli/__tests__/orgrt/write-verification.test.ts
// Scripted (no model): a role whose Write was refused and that then reports
// the task done is refused with the path named; a retry that lands, a file
// that exists, an honest blocked report and a healthy flow are all accepted.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { dagCreateTask } from '../../src/orgrt/decisions.js';
import { MAX_REFUSALS, WriteLedger } from '../../src/orgrt/write-ledger.js';

const TMP = process.env.TMPDIR ?? '/var/tmp';

const echoQuery = ({ prompt }: any) =>
  (async function* () {
    for await (const m of prompt) {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] },
      };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

async function boot(runConfig: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(TMP, 'wv-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs/alpha.json'),
    JSON.stringify({
      name: 'alpha',
      goal: 'g',
      run_config: runConfig,
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
      ],
    }),
  );
  const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
  const running = await d.startOrg('alpha');
  await d.deliver('alpha', 'boss', 'coder', 'hi', 'start');
  const newTask = (title = 'write answers'): string =>
    (JSON.parse(dagCreateTask(d, 'alpha', 'boss', title, 'coder', [])) as { id: string }).id;
  const done = (id: string, result = 'written'): any =>
    JSON.parse(d.dagCompleteTask('alpha', 'coder', id, result));
  /** The bus events the policy engine and the session loop emit for one Write. */
  const write = (path: string, callId: string, outcome: 'deny' | 'ok' | 'error', output = '') => {
    const base = { from: 'coder', tool: 'Write' };
    if (outcome === 'deny') {
      running.bus.emit({
        type: 'tool',
        ...base,
        decision: 'deny',
        reason: output,
        data: { input: { file_path: path } },
      });
      return;
    }
    running.bus.emit({
      type: 'tool',
      ...base,
      decision: 'allow',
      data: { input: { file_path: path }, call_id: callId },
    });
    running.bus.emit({
      type: 'tool_result',
      ...base,
      data: { call_id: callId, ok: outcome === 'ok', output },
    });
  };
  return { root, d, running, newTask, done, write };
}

describe('write verification', () => {
  it('A1: a denied Write followed by "done" is refused with the path named', async () => {
    const t = await boot();
    const path = join(t.root, 'out/m12/answers.json');
    const id = t.newTask();
    t.write(path, 'c1', 'deny', 'path escapes every root this role may use');
    const res = t.done(id);
    expect(res.error).toContain(path);
    expect(res.error).toContain('was refused');
    expect(res.error).toContain('blocked');
    expect(t.running.taskDag!.get(id)!.status).toBe('running'); // still open
    await t.d.stopAll();
  });

  it('A1b: a sandbox-refused Write (tool_result ok:false) is refused too', async () => {
    const t = await boot();
    const path = join(t.root, 'out/answers.json');
    const id = t.newTask();
    t.write(path, 'c1', 'error', 'EACCES: sandbox denied write');
    expect(t.done(id).error).toContain(path);
    await t.d.stopAll();
  });

  it('A2: a retry that succeeds is accepted', async () => {
    const t = await boot();
    const path = join(t.root, 'out/answers.json');
    const id = t.newTask();
    t.write(path, 'c1', 'error', 'sandbox refused');
    t.write(path, 'c2', 'ok');
    expect(t.done(id).error).toBeUndefined();
    expect(t.running.taskDag!.get(id)!.status).toBe('done');
    await t.d.stopAll();
  });

  it('accepts when the file exists with content, however it got there', async () => {
    const t = await boot();
    const path = join(t.root, 'out/answers.json');
    const id = t.newTask();
    t.write(path, 'c1', 'error', 'sandbox refused');
    writeFileSync(path, '{"ok":true}'); // e.g. written later through Bash
    expect(t.done(id).error).toBeUndefined();
    await t.d.stopAll();
  });

  it('accepts an honest report that names the path and says it is blocked', async () => {
    const t = await boot();
    const path = join(t.root, 'out/answers.json');
    const id = t.newTask();
    t.write(path, 'c1', 'deny', 'denied');
    const report = `BLOCKED: could not write ${path}, sandbox refused it`;
    expect(t.done(id, report).error).toBeUndefined();
    await t.d.stopAll();
  });

  it('refuses at most MAX_REFUSALS times, then lets the role through (never traps)', async () => {
    const t = await boot();
    const id = t.newTask();
    t.write(join(t.root, 'out/x.json'), 'c1', 'deny', 'denied');
    for (let i = 0; i < MAX_REFUSALS; i++) expect(t.done(id).error).toBeDefined();
    expect(t.done(id).error).toBeUndefined();
    await t.d.stopAll();
  });

  it('only the role that failed the write is refused', async () => {
    const t = await boot();
    const id = t.newTask();
    t.write(join(t.root, 'out/x.json'), 'c1', 'deny', 'denied');
    const res = JSON.parse(t.d.dagCompleteTask('alpha', 'boss', id, 'done'));
    expect(res.error ?? '').not.toContain('x.json');
    await t.d.stopAll();
  });

  it('run_config.verify_writes: false opts out', async () => {
    const t = await boot({ verify_writes: false });
    const id = t.newTask();
    t.write(join(t.root, 'out/x.json'), 'c1', 'deny', 'denied');
    expect(t.running.writeLedger).toBeUndefined();
    expect(t.done(id).error).toBeUndefined();
    await t.d.stopAll();
  });
});

describe('A3: healthy flows are unaffected', () => {
  const ev = (l: WriteLedger, e: Record<string, unknown>) =>
    l.observe({ id: 'e', ts: 0, org: 'o', run: 'r', ...e } as any);

  it('successful writes, a Write with no tool_result, an unknown call id and non-write tools never flag', () => {
    const root = mkdtempSync(join(TMP, 'wl-'));
    const l = new WriteLedger(() => [root]);
    const input = (p: string) => ({ file_path: p });
    ev(l, { type: 'tool', from: 'w', tool: 'Write', decision: 'allow', data: { input: input('a.txt'), call_id: '1' } });
    ev(l, { type: 'tool_result', from: 'w', tool: 'Write', data: { call_id: '1', ok: true } });
    // the runtime reports no result for this one
    ev(l, { type: 'tool', from: 'w', tool: 'Write', decision: 'allow', data: { input: input('b.txt'), call_id: '2' } });
    ev(l, { type: 'tool_result', from: 'w', tool: 'Write', data: { call_id: 'zzz', ok: false } });
    ev(l, { type: 'tool', from: 'w', tool: 'Bash', decision: 'deny', reason: 'no', data: { input: { command: 'ls' } } });
    ev(l, { type: 'tool_result', from: 'w', tool: 'Bash', data: { call_id: '9', ok: false } });
    expect(l.unresolved()).toEqual([]);
    expect(l.checkTaskDone('w', 'done')).toBeNull();
    expect(l.checkRunAchieved('all good')).toBeNull();
  });

  it('a failed Edit of a file that still exists with content is not flagged', () => {
    const root = mkdtempSync(join(TMP, 'wl-'));
    writeFileSync(join(root, 'f.txt'), 'content');
    const l = new WriteLedger(() => [root]);
    ev(l, { type: 'tool', from: 'w', tool: 'Edit', decision: 'allow', data: { input: { file_path: 'f.txt' }, call_id: '1' } });
    ev(l, { type: 'tool_result', from: 'w', tool: 'Edit', data: { call_id: '1', ok: false, output: 'old_string not found' } });
    expect(l.checkTaskDone('w', 'done')).toBeNull();
  });

  it("the lead's 'achieved' org_complete is refused for an unwritten deliverable", () => {
    const root = mkdtempSync(join(TMP, 'wl-'));
    const l = new WriteLedger(() => [root]);
    ev(l, {
      type: 'tool',
      from: 'worker-3',
      tool: 'Write',
      decision: 'deny',
      reason: 'sandbox',
      data: { input: { file_path: 'out/m12/answers.json' } },
    });
    const refusal = l.checkRunAchieved('all 33 done');
    expect(refusal).toContain('worker-3');
    expect(refusal).toContain('out/m12/answers.json');
    expect(refusal).toContain("'partial'");
  });
});
