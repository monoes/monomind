/**
 * ADR-O001 D7 — specialisation via a small catalog of stable loadouts.
 *
 *  - Layer 1, the loadout, lives in the SYSTEM PROMPT (cached): a named bundle
 *    of role-prompt text + skills. The boss SELECTS one by name, never composes.
 *  - Layer 2, per-task guidance, lives in the MESSAGE (not cached).
 *  - The loadout is recorded on the task row; every re-dispatch reuses it, so a
 *    retry is a retry and not a re-roll.
 *  - A live session's system prompt is never edited: a task whose loadout
 *    differs from the one its role's session was built with is recorded as a
 *    `loadout-mismatch`, not applied.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OrgBus } from '../orgrt/bus.js';
import { captureCheckpoint } from '../orgrt/checkpoint.js';
import { type AgentRuntime, OrgDaemon, type RunningOrg } from '../orgrt/daemon.js';
import {
  DISPATCH_COALESCE_MS,
  dagCompleteTask,
  dagCreateTask,
  dagPlanGraph,
  dispatchReadyTasks,
} from '../orgrt/decisions.js';
import {
  loadoutCatalog,
  MAX_LOADOUTS,
  resolveLoadout,
  sessionLoadoutFor,
  taskTag,
  validateLoadouts,
} from '../orgrt/loadouts.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { buildOrgTools, runAgentSession, type SessionOpts } from '../orgrt/session.js';
import { TaskDag } from '../orgrt/task-dag.js';
import { type BusEvent, ORG_DIR, type OrgDef, OrgDefSchema, type OrgRole } from '../orgrt/types.js';

const settleDispatch = (): Promise<void> =>
  new Promise((r) => setTimeout(r, DISPATCH_COALESCE_MS + 50));

function catalog(n: number): Record<string, { prompt: string }> {
  const out: Record<string, { prompt: string }> = {};
  for (let i = 0; i < n; i++) out[`kind-${i}`] = { prompt: `You do kind ${i} work.` };
  return out;
}

const FIVE = {
  implement: { description: 'write code to spec', prompt: 'Implement exactly the spec.' },
  review: { description: 'review a diff', prompt: 'Review the diff only.', skills: ['reviewer'] },
  test: { prompt: 'Write the failing test first.', skills: ['tester'] },
  docs: { prompt: 'Write docs.' },
  triage: { prompt: 'Triage issues.' },
};

function defWith(loadouts?: unknown, extra: Record<string, unknown> = {}): OrgDef {
  return OrgDefSchema.parse({
    name: 'acme',
    goal: 'ship',
    roles: [
      { id: 'boss', title: 'Boss', type: 'coordinator' },
      { id: 'dev', title: 'Dev', type: 'specialist', reports_to: 'boss' },
    ],
    ...(loadouts === undefined ? {} : { loadouts }),
    ...extra,
  });
}

describe('validateLoadouts', () => {
  it('an org with no catalog has nothing to report', () => {
    expect(validateLoadouts(defWith(), '/nowhere')).toEqual({ errors: [], warnings: [] });
  });

  it('accepts a catalog in the 5–15 target band with no warnings', () => {
    expect(validateLoadouts(defWith(catalog(5)), '/nowhere')).toEqual({ errors: [], warnings: [] });
    expect(validateLoadouts(defWith(catalog(15)), '/nowhere')).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it(`rejects more than ${15} loadouts — variety is what costs, not specialisation`, () => {
    expect(MAX_LOADOUTS).toBe(15);
    const { errors } = validateLoadouts(defWith(catalog(16)), '/nowhere');
    expect(errors.join('\n')).toMatch(/16 loadouts.*at most 15/);
  });

  it('allows fewer than 5 with a warning (below target, not wrong)', () => {
    const r = validateLoadouts(defWith(catalog(2)), '/nowhere');
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/2 loadouts.*5–15/);
  });

  it('rejects an empty catalog, an empty loadout, a bad name and an unknown skill', () => {
    expect(validateLoadouts(defWith({}), '/nowhere').errors.join('\n')).toMatch(/omit/);
    const errs = validateLoadouts(
      defWith({ ...catalog(4), hollow: {}, 'Bad Name!': { prompt: 'x' }, s: { skills: ['nope'] } }),
      '/nowhere',
    ).errors.join('\n');
    expect(errs).toMatch(/"hollow".*no prompt/);
    expect(errs).toMatch(/"Bad Name!"/);
    expect(errs).toMatch(/"s".*unknown skill "nope"/);
  });

  it('rejects an instructions_file that does not resolve (a silently-missing file would change the prompt)', () => {
    const root = mkdtempSync(join(tmpdir(), 'loadout-file-'));
    writeFileSync(join(root, 'impl.md'), 'FROM FILE');
    const ok = validateLoadouts(
      defWith({ ...catalog(4), f: { instructions_file: 'impl.md' } }),
      root,
    );
    expect(ok.errors).toEqual([]);
    const bad = validateLoadouts(
      defWith({ ...catalog(4), f: { instructions_file: 'missing.md' } }),
      root,
    );
    expect(bad.errors.join('\n')).toMatch(/"f".*missing\.md/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('resolveLoadout', () => {
  it('bundles prompt, built-in skills and the instructions file in a fixed order', () => {
    const root = mkdtempSync(join(tmpdir(), 'loadout-resolve-'));
    writeFileSync(join(root, 'r.md'), 'FILE TEXT');
    const def = defWith({ ...FIVE, review: { ...FIVE.review, instructions_file: 'r.md' } });
    const r = resolveLoadout(def, 'review', root);
    expect(r.name).toBe('review');
    const iPrompt = r.guidance.indexOf('Review the diff only.');
    const iFile = r.guidance.indexOf('FILE TEXT');
    expect(r.guidance.startsWith('## Loadout: review')).toBe(true);
    expect(iPrompt).toBeGreaterThan(0);
    expect(iFile).toBeGreaterThan(iPrompt);
    expect(resolveLoadout(def, 'review', root).guidance).toBe(r.guidance);
    expect(() => resolveLoadout(def, 'nope', root)).toThrow(/unknown loadout "nope"/);
    rmSync(root, { recursive: true, force: true });
  });

  it('loadoutCatalog is undefined without a catalog, else names + descriptions in declared order', () => {
    expect(loadoutCatalog(defWith())).toBeUndefined();
    expect(loadoutCatalog(defWith(FIVE))?.map((l) => l.name)).toEqual([
      'implement',
      'review',
      'test',
      'docs',
      'triage',
    ]);
    expect(loadoutCatalog(defWith(FIVE))?.[0].description).toBe('write code to spec');
  });
});

// ── The ADR's acceptance test ──────────────────────────────────────────────

async function sessionPrompt(opts: Partial<SessionOpts>, message: string): Promise<string> {
  const bus = new OrgBus('acme', 'r', mkdtempSync(join(tmpdir(), 'loadout-sess-')));
  const mailbox = new Mailbox();
  mailbox.push(message);
  mailbox.close();
  let systemPrompt = '';
  const fakeQuery = ({ prompt, options }: any) =>
    (async function* () {
      systemPrompt = options.systemPrompt;
      for await (const _ of prompt) break;
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  const role = { id: 'dev', title: 'Dev', type: 'specialist', reports_to: 'boss' } as OrgRole;
  await runAgentSession({
    org: 'acme',
    role,
    bus,
    policy: new PolicyEngine('dev', {}, bus, '/work'),
    mailbox,
    cwd: '/work',
    def: defWith(FIVE),
    deliver: async () => 'ok',
    queryFn: fakeQuery as any,
    ...opts,
  });
  return systemPrompt;
}

describe('ADR-O001 D7 acceptance: same kind of work, byte-identical system prompt', () => {
  it('two sessions serving different tasks with the same loadout get the identical system prompt', async () => {
    const def = defWith(FIVE);
    const loadout = resolveLoadout(def, 'implement', '/nowhere');
    const a = await sessionPrompt({ loadout }, '[task:task-1] [loadout:implement] add the parser');
    const b = await sessionPrompt(
      { loadout: resolveLoadout(def, 'implement', '/nowhere') },
      '[task:task-7] [loadout:implement] fix the lexer — last attempt failed: 2 tests red',
    );
    expect(a).toContain('Implement exactly the spec.');
    expect(b).toBe(a);
    // Layer 2 stays out of the prefix: nothing task-specific leaked in.
    expect(a).not.toContain('parser');
    expect(b).not.toContain('lexer');
  });

  it('a different loadout is a different prompt (so the test above is not vacuous)', async () => {
    const def = defWith(FIVE);
    const impl = await sessionPrompt({ loadout: resolveLoadout(def, 'implement', '/n') }, 'x');
    const rev = await sessionPrompt({ loadout: resolveLoadout(def, 'review', '/n') }, 'x');
    expect(rev).not.toBe(impl);
    expect(rev).toContain('Review the diff only.');
  });
});

// ── Tool list: identical across loadouts, gated on the catalog ─────────────

function toolOpts(extra: Partial<SessionOpts> = {}): SessionOpts {
  return {
    org: 'acme',
    role: { id: 'boss' } as OrgRole,
    bus: {} as OrgBus,
    policy: {} as PolicyEngine,
    mailbox: {} as Mailbox,
    cwd: '/work',
    deliver: async () => 'ok',
    createTask: () => 'ok',
    planGraph: () => 'ok',
    ...extra,
  } as SessionOpts;
}
const render = (opts: SessionOpts) =>
  buildOrgTools(opts).map((t) => ({
    name: t.name,
    description: t.description,
    schema: z.toJSONSchema(z.object(t.schema as z.ZodRawShape)),
  }));

describe('org_task / org_plan_graph loadout argument', () => {
  it('appears only when the org declares a catalog, and lists the catalog', () => {
    const plain = render(toolOpts());
    const withCat = render(toolOpts({ loadoutCatalog: loadoutCatalog(defWith(FIVE)) }));
    expect(withCat.map((t) => t.name)).toEqual(plain.map((t) => t.name));

    const task = withCat.find((t) => t.name === 'org_task')!;
    expect(JSON.stringify(task.schema)).toContain('"loadout"');
    expect(task.description).toContain('implement (write code to spec)');
    const plainTask = plain.find((t) => t.name === 'org_task')!;
    expect(JSON.stringify(plainTask.schema)).not.toContain('loadout');

    const plan = withCat.find((t) => t.name === 'org_plan_graph')!;
    expect(JSON.stringify(plan.schema)).toContain('"loadout"');
  });

  it('the tool list does not depend on which loadout the session was built with', () => {
    const def = defWith(FIVE);
    const cat = loadoutCatalog(def);
    const a = render(
      toolOpts({ loadoutCatalog: cat, loadout: resolveLoadout(def, 'implement', '/n') }),
    );
    const b = render(
      toolOpts({ loadoutCatalog: cat, loadout: resolveLoadout(def, 'review', '/n') }),
    );
    const c = render(toolOpts({ loadoutCatalog: cat }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });

  it('passes the selected loadout through to the createTask / planGraph callbacks', async () => {
    const seen: unknown[] = [];
    const tools = buildOrgTools(
      toolOpts({
        loadoutCatalog: loadoutCatalog(defWith(FIVE)),
        createTask: (_r, _t, _a, _d, loadout) => {
          seen.push(loadout);
          return 'ok';
        },
        planGraph: (_r, specs) => {
          seen.push(specs.map((s) => s.loadout));
          return 'ok';
        },
      }),
    );
    await tools
      .find((t) => t.name === 'org_task')!
      .handler({
        title: 't',
        assignee: 'dev',
        deps: [],
        loadout: 'review',
      });
    await tools
      .find((t) => t.name === 'org_plan_graph')!
      .handler({
        tasks: [{ name: 'a', title: 't', assignee: 'dev', after: [], loadout: 'test' }],
      });
    expect(seen).toEqual(['review', ['test']]);
  });
});

// ── Task row ────────────────────────────────────────────────────────────────

describe('TaskDag records the loadout on the task row', () => {
  it('stores it, survives a checkpoint round-trip, and split children inherit it', () => {
    const dag = new TaskDag();
    const t = dag.add('build', 'dev', [], 'implement');
    expect(t.loadout).toBe('implement');
    expect(dag.add('plain', 'dev', []).loadout).toBeUndefined();
    const again = TaskDag.fromJSON(JSON.parse(JSON.stringify(dag.toJSON())));
    expect(again.get(t.id)?.loadout).toBe('implement');
    const kids = again.split(t.id, [{ title: 'half a', assignee: 'dev' }]);
    expect(kids[0].loadout).toBe('implement');
  });

  it('a task with no loadout serialises exactly as before (no new key)', () => {
    const dag = new TaskDag();
    dag.add('plain', 'dev', []);
    expect(Object.keys(dag.all()[0])).not.toContain('loadout');
  });

  it('taskTag names the loadout in the MESSAGE only when one was selected', () => {
    const dag = new TaskDag();
    expect(taskTag(dag.add('a', 'dev', []))).toBe('[task:task-1]');
    expect(taskTag(dag.add('b', 'dev', [], 'review'))).toBe('[task:task-2] [loadout:review]');
  });

  it("sessionLoadoutFor picks the loadout of the role's first ready task, deterministically", () => {
    const dag = new TaskDag();
    dag.add('other role', 'qa', [], 'test');
    dag.add('first', 'dev', [], 'implement');
    dag.add('second', 'dev', [], 'review');
    expect(sessionLoadoutFor(dag, 'dev')).toBe('implement');
    expect(sessionLoadoutFor(dag, 'nobody')).toBeUndefined();
    expect(sessionLoadoutFor(undefined, 'dev')).toBeUndefined();
  });
});

// ── Dispatch and re-dispatch ────────────────────────────────────────────────

function makeAgent(loadout?: string): AgentRuntime {
  return {
    mailbox: new Mailbox(),
    policy: {} as unknown as PolicyEngine,
    done: Promise.resolve(),
    status: 'running',
    metrics: { tokens: 0, costUsd: 0 },
    scrollback: { push: () => {}, all: () => [], snapshot: () => [] } as any,
    ...(loadout ? { loadout } : {}),
  };
}

describe('dispatch uses the recorded loadout; re-dispatch never re-selects', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function setup(opts: { loadouts?: unknown; devLoadout?: string; evidence?: boolean } = {}) {
    tmp = mkdtempSync(join(tmpdir(), 'loadout-dispatch-'));
    const repo = join(tmp, 'repo');
    mkdirSync(repo);
    const daemon = new OrgDaemon(tmp);
    const bus = new OrgBus('acme', 'run-1', join(tmp, ORG_DIR, 'acme', 'run-1'));
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const dev = makeAgent(opts.devLoadout);
    const boss = makeAgent();
    const running: RunningOrg = {
      def: defWith(opts.loadouts === null ? undefined : (opts.loadouts ?? FIVE), {
        run_config: { completion_evidence: opts.evidence ?? false },
      }),
      run: 'run-1',
      bus,
      agents: new Map([
        ['dev', dev],
        ['boss', boss],
      ]),
      busEvents: () => [],
      roleSlots: new Map(),
      bossRoleId: 'boss',
      glossary: [],
      respawning: new Set(),
      taskDag: new TaskDag(),
      workdir: repo,
    };
    daemon.orgs.set('acme', running);
    return { daemon, running, dev, boss, events };
  }

  it('org_task records the selected loadout and names it in the dispatch message', async () => {
    const { daemon, running, dev } = setup({ devLoadout: 'implement' });
    const out = JSON.parse(
      dagCreateTask(daemon, 'acme', 'boss', 'add parser', 'dev', [], 'implement'),
    );
    expect(running.taskDag?.get(out.id)?.loadout).toBe('implement');
    await settleDispatch();
    expect(dev.mailbox.serialize().queue.join('\n')).toContain(
      `[task:${out.id}] [loadout:implement] add parser`,
    );
    daemon.orgs.delete('acme');
  });

  it('rejects an unknown loadout, and any loadout in an org without a catalog', () => {
    const a = setup();
    expect(
      JSON.parse(dagCreateTask(a.daemon, 'acme', 'boss', 't', 'dev', [], 'nope')).error,
    ).toMatch(/unknown loadout "nope"/);
    // A prototype key is not a catalog entry.
    expect(
      JSON.parse(dagCreateTask(a.daemon, 'acme', 'boss', 't', 'dev', [], 'constructor')).error,
    ).toMatch(/unknown loadout "constructor"/);
    expect(() => resolveLoadout(a.running.def, 'toString', '/n')).toThrow(/unknown loadout/);
    expect(a.running.taskDag?.all()).toHaveLength(0);
    a.daemon.orgs.delete('acme');
    rmSync(tmp, { recursive: true, force: true });

    const b = setup({ loadouts: null });
    expect(
      JSON.parse(dagCreateTask(b.daemon, 'acme', 'boss', 't', 'dev', [], 'implement')).error,
    ).toMatch(/no loadout catalog/);
    b.daemon.orgs.delete('acme');
  });

  it('org_plan_graph records per-spec loadouts and rejects the whole plan on an unknown one', () => {
    const { daemon, running } = setup();
    const bad = JSON.parse(
      dagPlanGraph(daemon, 'acme', 'boss', [
        { name: 'a', title: 'A', assignee: 'dev', loadout: 'implement' },
        { name: 'b', title: 'B', assignee: 'dev', loadout: 'nope' },
      ]),
    );
    expect(bad.error).toMatch(/unknown loadout "nope"/);
    expect(running.taskDag?.all()).toHaveLength(0);
    const ok = JSON.parse(
      dagPlanGraph(daemon, 'acme', 'boss', [
        { name: 'a', title: 'A', assignee: 'dev', loadout: 'implement' },
        { name: 'b', title: 'B', assignee: 'dev', after: ['a'], loadout: 'review' },
      ]),
    );
    expect(ok.planned).toBe(2);
    expect(running.taskDag?.all().map((t) => t.loadout)).toEqual(['implement', 'review']);
    daemon.orgs.delete('acme');
  });

  // THE determinism test: a task that fails and is re-dispatched is served with
  // the same recorded loadout every time — the evidence gate's "3 failures then
  // escalate" counts three attempts at the same thing.
  it('a task that fails the evidence gate is re-dispatched with its recorded loadout, every time', async () => {
    const { daemon, running, dev, boss } = setup({ devLoadout: 'implement', evidence: true });
    const task = running.taskDag!.add('ship it', 'dev', [], 'implement');
    dispatchReadyTasks(daemon, 'acme', running);
    await settleDispatch();

    for (let i = 0; i < 2; i++) {
      const r = JSON.parse(dagCompleteTask(daemon, 'acme', 'dev', task.id, 'trust me'));
      expect(r.requeued).toBe(task.id);
      expect(running.taskDag?.get(task.id)?.loadout).toBe('implement');
    }
    await settleDispatch();
    const q = dev.mailbox.serialize().queue.join('\n');
    const redispatches = q.match(/\[task:task-1\] \[loadout:implement\]/g) ?? [];
    // first dispatch + two re-dispatches (+ the NOT CLOSED notices), all tagged the same
    expect(redispatches.length).toBeGreaterThanOrEqual(3);
    expect(q).not.toMatch(/\[loadout:(?!implement)/);

    // Third failure escalates — still recorded against the same loadout.
    expect(JSON.parse(dagCompleteTask(daemon, 'acme', 'dev', task.id, 'x')).escalated).toBe(
      task.id,
    );
    expect(running.taskDag?.get(task.id)?.loadout).toBe('implement');
    await settleDispatch();
    expect(boss.mailbox.serialize().queue.join('\n')).toContain(
      '[task:task-1] [loadout:implement] ESCALATED',
    );
    daemon.orgs.delete('acme');
  });

  it('checkpoint resume re-dispatches a requeued task with the loadout from the row', async () => {
    const { daemon, running, dev } = setup({ devLoadout: 'review' });
    const task = running.taskDag!.add('look at diff', 'dev', [], 'review');
    running.taskDag!.markRunning(task.id);
    const cp = captureCheckpoint(running);
    running.taskDag = TaskDag.fromJSON(cp.tasks ?? []);
    running.taskDag.requeue(task.id);
    dispatchReadyTasks(daemon, 'acme', running);
    await settleDispatch();
    expect(dev.mailbox.serialize().queue.join('\n')).toContain('[task:task-1] [loadout:review]');
    daemon.orgs.delete('acme');
  });

  it("records a mismatch honestly instead of editing a live session's prompt", async () => {
    const { daemon, running, dev, events } = setup({ devLoadout: 'implement' });
    running.taskDag!.add('review this', 'dev', [], 'review');
    dispatchReadyTasks(daemon, 'acme', running);
    await settleDispatch();
    const ev = events.find((e) => e.reason === 'loadout-mismatch');
    expect(ev?.data).toMatchObject({
      taskId: 'task-1',
      assignee: 'dev',
      taskLoadout: 'review',
      sessionLoadout: 'implement',
    });
    // Delivered anyway (liveness), and the session's loadout is untouched.
    expect(dev.mailbox.serialize().queue.join('\n')).toContain('[task:task-1] [loadout:review]');
    expect(dev.loadout).toBe('implement');
    daemon.orgs.delete('acme');
  });

  it('no mismatch event when the loadouts agree, or when the task selected none', async () => {
    const { daemon, running, events } = setup({ devLoadout: 'implement' });
    running.taskDag!.add('a', 'dev', [], 'implement');
    running.taskDag!.add('b', 'dev', []);
    dispatchReadyTasks(daemon, 'acme', running);
    await settleDispatch();
    expect(events.find((e) => e.reason === 'loadout-mismatch')).toBeUndefined();
    daemon.orgs.delete('acme');
  });

  it('the checkpoint carries the loadout a role session was built with', () => {
    const { daemon, running } = setup({ devLoadout: 'implement' });
    const cp = captureCheckpoint(running);
    expect(cp.roleState.dev.loadout).toBe('implement');
    expect('loadout' in cp.roleState.boss).toBe(false);
    daemon.orgs.delete('acme');
  });
});

// ── End to end through the daemon: a lazily spawned role gets its task's loadout

describe("OrgDaemon: the session that serves a task is built with the task's loadout", () => {
  it('lazily spawns the assignee with the loadout recorded on its first task', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loadout-daemon-'));
    mkdirSync(join(root, ORG_DIR), { recursive: true });
    writeFileSync(
      join(root, ORG_DIR, 'acme.json'),
      JSON.stringify({
        name: 'acme',
        goal: 'ship',
        loadouts: FIVE,
        roles: [
          { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
          { id: 'dev', title: 'Dev', type: 'specialist', reports_to: 'boss' },
        ],
      }),
    );
    const prompts: Record<string, string> = {};
    const q = ({ prompt, options }: any) => {
      const id = /You are agent "([^"]+)"/.exec(options.systemPrompt)?.[1] ?? '?';
      prompts[id] = options.systemPrompt;
      return (async function* () {
        for await (const _ of prompt) {
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
      })();
    };
    const d = new OrgDaemon(root, { queryFn: q as any, forward: false });
    const running = await d.startOrg('acme');
    dagCreateTask(d, 'acme', 'boss', 'review the diff', 'dev', [], 'review');
    const t0 = Date.now();
    while (!prompts.dev && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
    expect(prompts.dev).toContain('## Loadout: review');
    expect(prompts.boss).not.toContain('## Loadout:');
    expect(running.agents.get('dev')?.loadout).toBe('review');
    await d.stopAll();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses to start an org whose catalog is over the cap', async () => {
    const root = mkdtempSync(join(tmpdir(), 'loadout-daemon-cap-'));
    mkdirSync(join(root, ORG_DIR), { recursive: true });
    writeFileSync(
      join(root, ORG_DIR, 'acme.json'),
      JSON.stringify({
        name: 'acme',
        goal: 'ship',
        loadouts: catalog(16),
        roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
      }),
    );
    const d = new OrgDaemon(root, {
      queryFn: (() => (async function* () {})()) as any,
      forward: false,
    });
    await expect(d.startOrg('acme')).rejects.toThrow(/at most 15/);
    rmSync(root, { recursive: true, force: true });
  });
});
