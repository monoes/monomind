// packages/@monomind/cli/__tests__/orgrt/packet.test.ts
//
// Org sections spec 6.8, Phase 2: the context packet. A task's declared
// references (file paths, memory keys, task ids) travel with its dispatch, the
// declared parts are bounded together, and the runtime records exactly what it
// injected: the first message of every fresh SDK session (a generation) with
// its hash and each part's hash. A resumed session adds no record; a new
// generation appends one.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { dagCreateTask } from '../../src/orgrt/decisions.js';
import { checkPacket, countReferences, MAX_PACKET_CHARS, MAX_REFERENCES, renderReferences, readPacketLog } from '../../src/orgrt/packet.js';
import { buildOrgTools, type SessionOpts } from '../../src/orgrt/session.js';
import { setOrgSignatureEnforcement } from '../../src/orgrt/org-signature-enforcement.js';
import { OrgDefSchema, type OrgRole } from '../../src/orgrt/types.js';
import type { OrgBus } from '../../src/orgrt/bus.js';
import type { Mailbox } from '../../src/orgrt/mailbox.js';
import type { PolicyEngine } from '../../src/orgrt/policy.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('references', () => {
  it('renders files, memory keys and task ids, and nothing for an empty set', () => {
    expect(renderReferences({ files: ['/a/b.md'], memory_keys: ['k1'], task_ids: ['task-1', 'task-2'] })).toBe(
      'References:\nFiles: /a/b.md\nMemory keys: k1\nTasks: task-1, task-2',
    );
    expect(renderReferences({ files: ['/x'] })).toBe('References:\nFiles: /x');
    expect(renderReferences(undefined)).toBe('');
    expect(renderReferences({ files: [] })).toBe('');
  });
  it('counts distinct references across kinds', () => {
    expect(countReferences({ files: ['a', 'a', 'b'], memory_keys: ['a'], task_ids: ['t'] })).toBe(4); // a (file), b, a (key), t
  });
});

describe('checkPacket', () => {
  it('passes a packet within the limits', () => {
    expect(checkPacket({ title: 't', brief: 'b', references: { files: ['/a'] } })).toBeUndefined();
  });
  it('rejects more than 256 distinct references, never dropping any', () => {
    const files = Array.from({ length: MAX_REFERENCES + 1 }, (_, i) => `/f/${i}`);
    expect(checkPacket({ title: 't', references: { files } })).toMatch(/257 references.*256/);
    expect(checkPacket({ title: 't', references: { files: files.slice(0, MAX_REFERENCES) } })).toBeUndefined();
  });
  it('rejects declared parts over the first-message limit, naming the remedy', () => {
    const files = Array.from({ length: 200 }, (_, i) => `/very/long/path/${'x'.repeat(60)}/${i}`);
    const err = checkPacket({ title: 't', brief: 'b'.repeat(3900), references: { files } });
    expect(err).toMatch(new RegExp(`over ${MAX_PACKET_CHARS}`));
    expect(err).toMatch(/split the task|fewer references/);
  });
});

const orgDef = (context?: unknown) =>
  OrgDefSchema.parse({
    name: 'o',
    goal: 'g',
    run_config: context === undefined ? {} : { context },
    roles: [
      { id: 'boss', title: 'B', type: 'boss' },
      { id: 'dev', title: 'D', type: 'd', reports_to: 'boss' },
    ],
  });
const tools = (context: unknown, extra: Record<string, unknown> = {}) =>
  buildOrgTools({
    org: 'o', role: { id: 'boss' } as OrgRole, def: orgDef(context), bus: {} as OrgBus, policy: {} as PolicyEngine,
    mailbox: {} as Mailbox, cwd: '/work', deliver: async () => 'ok', createTask: () => '{"id":"t1"}', planGraph: () => '{"created":1}', ...extra,
  } as SessionOpts);

describe('references on org_task and org_plan_graph', () => {
  it('exist only for an org that adopted the context surface', () => {
    const keys = (t: ReturnType<typeof tools>) => Object.keys(t.find((x) => x.name === 'org_task')!.schema);
    expect(keys(tools(undefined))).not.toContain('references');
    expect(keys(tools({ notes: true }))).toContain('references');
  });
  it('pass the references through to createTask, and reject an over-limit packet before creating anything', async () => {
    const createTask = vi.fn(() => '{"id":"t1"}');
    const t = tools({ notes: true }, { createTask }).find((x) => x.name === 'org_task')!;
    await t.handler({ title: 'T', assignee: 'dev', deps: [], objective: 'o', acceptance: 'a', references: { files: ['/a'], task_ids: ['task-1'] } });
    expect(createTask.mock.calls[0][7]).toEqual({ files: ['/a'], task_ids: ['task-1'] });

    const many = Array.from({ length: 300 }, (_, i) => `/f/${i}`);
    const out = JSON.parse((await t.handler({ title: 'T', assignee: 'dev', deps: [], references: { files: many } })).text);
    expect(out.error).toMatch(/references/);
    expect(createTask).toHaveBeenCalledTimes(1);
  });
  it('are validated as arrays of strings', () => {
    const t = tools({ notes: true }).find((x) => x.name === 'org_task')!;
    const schema = z.object(t.schema as z.ZodRawShape);
    expect(schema.safeParse({ title: 't', assignee: 'a', references: { files: 'no' } }).success).toBe(false);
    expect(schema.safeParse({ title: 't', assignee: 'a', references: { urls: ['x'] } }).success).toBe(false);
  });
  it('org_plan_graph tasks carry them too', async () => {
    const planGraph = vi.fn(() => '{"created":1}');
    const plan = tools({ notes: true }, { planGraph }).find((x) => x.name === 'org_plan_graph')!;
    await plan.handler({ tasks: [{ name: 'a', title: 'A', assignee: 'dev', after: [], references: { files: ['/a'] } }] });
    expect((planGraph.mock.calls[0][1] as { references: unknown }[])[0].references).toEqual({ files: ['/a'] });
  });
});

// --- the dispatch and the per-generation record, through a real daemon ---------

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopAll();
  daemon = undefined;
});

async function waitUntil(pred: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

async function dispatchedOrg(context: unknown) {
  setOrgSignatureEnforcement(false);
  const root = mkdtempSync(join(tmpdir(), 'packet-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs/o.json'),
    JSON.stringify({
      name: 'o', goal: 'g', run_config: { session_scope: 'task', ...(context === undefined ? {} : { context }) },
      roles: [
        { id: 'boss', title: 'B', type: 'boss', reports_to: null },
        { id: 'dev', title: 'D', type: 'specialist', reports_to: 'boss' },
      ],
    }),
  );
  const firstMessages: string[] = [];
  const queryFn = (({ prompt, options }: any) => {
    const role = /You are agent "([^"]+)"/.exec(options.systemPrompt)?.[1];
    return (async function* () {
      let first = true;
      for await (const m of prompt) {
        if (role === 'dev' && first) firstMessages.push(String(m.message.content));
        first = false;
        yield { type: 'result', subtype: 'success', session_id: `sdk-${role}`, usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 };
      }
    })();
  }) as never;
  daemon = new OrgDaemon(root, { queryFn, forward: false, stopWaitMs: 100, crashBackoffsMs: [] });
  const running = await daemon.startOrg('o');
  return { root, running, firstMessages };
}

describe('dispatch with references', () => {
  it('appends the references block after the brief; a task without references is dispatched exactly as before', async () => {
    const { running, firstMessages } = await dispatchedOrg({ notes: true });
    dagCreateTask(daemon!, 'o', 'boss', 'Plain', 'dev', [], undefined, 'just the brief');
    expect(await waitUntil(() => firstMessages.length >= 1)).toBe(true);
    expect(firstMessages[0]).toMatch(/\[task:task-1\] Plain\n\njust the brief$/);

    dagCreateTask(daemon!, 'o', 'boss', 'Refs', 'dev', [], undefined, 'the brief', undefined, { files: ['/a/b.md'], memory_keys: ['k'] });
    expect(await waitUntil(() => firstMessages.length >= 2)).toBe(true);
    expect(firstMessages[1]).toMatch(/\[task:task-2\] Refs\n\nthe brief\n\nReferences:\nFiles: \/a\/b\.md\nMemory keys: k$/);
    expect(running.taskDag!.get('task-2')!.references).toEqual({ files: ['/a/b.md'], memory_keys: ['k'] });
  });
});

describe('the per-generation record of what was injected', () => {
  it('records the packet with its parts, and the first message of the session with its hash', async () => {
    const { running, firstMessages } = await dispatchedOrg({ notes: true });
    dagCreateTask(daemon!, 'o', 'boss', 'Refs', 'dev', [], undefined, 'the brief', undefined, { files: ['/a/b.md'] });
    expect(await waitUntil(() => firstMessages.length >= 1)).toBe(true);
    await running.bus.flush();
    const log = readPacketLog(running.bus.dir);

    const packet = log.find((r) => r.kind === 'packet')!;
    expect(packet).toMatchObject({ task_id: 'task-1', role: 'dev' });
    expect(packet.parts.map((p) => p.name)).toEqual(['task', 'brief', 'references']);
    expect(packet.parts[2].sha256).toBe(sha('References:\nFiles: /a/b.md'));
    expect(packet.sha256).toBe(sha(packet.text));

    // The boss's own role-wide session start is recorded too; this is the worker's task session.
    const gen = log.find((r) => r.kind === 'generation' && r.role === 'dev')!;
    expect(gen).toMatchObject({ role: 'dev', task_key: 'task-1', generation: 0, resumed: false });
    // What the runner received is exactly what was recorded.
    expect(gen.first_message_sha256).toBe(sha(firstMessages[0]));
    expect(gen.chars).toBe(firstMessages[0].length);
    // And it carries the packet, so the parts apply to it.
    expect(gen.packet_task_id).toBe('task-1');
    expect(firstMessages[0]).toContain(packet.text);
  });

  it('adds no record for a later message in the same session, and one per task session', async () => {
    const { running, firstMessages } = await dispatchedOrg({ notes: true });
    dagCreateTask(daemon!, 'o', 'boss', 'One', 'dev', [], undefined, 'b1');
    dagCreateTask(daemon!, 'o', 'boss', 'Two', 'dev', [], undefined, 'b2');
    expect(await waitUntil(() => firstMessages.length >= 2)).toBe(true);
    await daemon!.deliver('o', 'boss', 'dev', '[task:task-1] follow up', 'more');
    await new Promise((r) => setTimeout(r, 100));
    await running.bus.flush();
    const gens = readPacketLog(running.bus.dir).filter((r) => r.kind === 'generation' && r.role === 'dev');
    expect(gens.map((g) => g.task_key).sort()).toEqual(['task-1', 'task-2']);
  });

  it('writes nothing for an org that adopted nothing', async () => {
    const { running, firstMessages } = await dispatchedOrg(undefined);
    dagCreateTask(daemon!, 'o', 'boss', 'Plain', 'dev', [], undefined, 'b');
    expect(await waitUntil(() => firstMessages.length >= 1)).toBe(true);
    await running.bus.flush();
    expect(readPacketLog(running.bus.dir)).toEqual([]);
  });
});
