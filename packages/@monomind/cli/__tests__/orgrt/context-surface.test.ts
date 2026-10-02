// packages/@monomind/cli/__tests__/orgrt/context-surface.test.ts
//
// Org sections spec 6.8, Phase 2: the opt-in surface and typed brief fields.
// An org that sets a `run_config.context` key gets typed brief fields on
// org_task / org_plan_graph, which extend the existing free-text brief into one
// rendered brief under the same 4,000-char limit. An org that adopts nothing
// keeps its tool list and prompt byte for byte.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { contextSurface } from '../../src/orgrt/context-surface.js';
import type { OrgBus } from '../../src/orgrt/bus.js';
import type { Mailbox } from '../../src/orgrt/mailbox.js';
import type { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildOrgTools, type SessionOpts } from '../../src/orgrt/session.js';
import { MAX_TASK_BRIEF } from '../../src/orgrt/task-dag.js';
import { OrgDefSchema, type OrgRole } from '../../src/orgrt/types.js';

const def = (context?: unknown) =>
  OrgDefSchema.parse({
    name: 'o',
    goal: 'g',
    run_config: context === undefined ? {} : { context },
    roles: [
      { id: 'boss', title: 'B', type: 'boss' },
      { id: 'dev', title: 'D', type: 'd', reports_to: 'boss' },
    ],
  });

function tools(context: unknown, extra: Record<string, unknown> = {}) {
  return buildOrgTools({
    org: 'o',
    role: { id: 'boss' } as OrgRole,
    def: def(context),
    bus: {} as OrgBus,
    policy: {} as PolicyEngine,
    mailbox: {} as Mailbox,
    cwd: '/work',
    deliver: async () => 'ok',
    createTask: () => '{"id":"t1"}',
    planGraph: () => '{"created":1}',
    ...extra,
  } as SessionOpts);
}

/** What a model is shown: names, descriptions and argument shapes, in order. */
const fingerprint = (list: ReturnType<typeof tools>) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        list.map((t) => [t.name, t.description, Object.keys(t.schema), JSON.stringify(z.toJSONSchema(z.object(t.schema as z.ZodRawShape)))]),
      ),
    )
    .digest('hex');

const FIELDS = ['objective', 'output', 'tools', 'boundaries', 'acceptance'];

describe('contextSurface', () => {
  it('is off for an org with no context key, or an empty one', () => {
    expect(contextSurface(def()).enabled).toBe(false);
    expect(contextSurface(def({})).enabled).toBe(false);
    expect(contextSurface(def({ notes: false })).enabled).toBe(false);
  });
  it('is on for require_brief, notes: true or a session cap', () => {
    expect(contextSurface(def({ require_brief: true }))).toMatchObject({ enabled: true, requireBrief: true });
    expect(contextSurface(def({ require_brief: false }))).toMatchObject({ enabled: true, requireBrief: false });
    expect(contextSurface(def({ notes: true }))).toMatchObject({ enabled: true, notes: true });
    expect(contextSurface(def({ session_cap: { tasks: 10 } }))).toMatchObject({ enabled: true, sessionCap: { tasks: 10 } });
  });
});

describe('run_config.context in the org schema', () => {
  it('accepts its three keys and rejects anything else or a non-positive cap', () => {
    expect(() => def({ require_brief: true, notes: true, session_cap: { tasks: 40, tokens: 2_000_000 } })).not.toThrow();
    expect(() => def({ nope: true })).toThrow();
    expect(() => def({ session_cap: { tasks: 0 } })).toThrow();
    expect(() => def({ session_cap: { pages: 3 } })).toThrow();
  });
});

describe('an org that adopts nothing keeps its tools and prompt byte for byte', () => {
  it('has the same tool fingerprint with no context, an empty one, or notes: false', () => {
    const base = fingerprint(tools(undefined));
    expect(fingerprint(tools({}))).toBe(base);
    expect(fingerprint(tools({ notes: false }))).toBe(base);
  });
  it('shows org_task and org_plan_graph only today\'s arguments, and no org_note_append', () => {
    const list = tools(undefined);
    expect(Object.keys(list.find((t) => t.name === 'org_task')!.schema)).toEqual(['title', 'assignee', 'deps', 'brief']);
    expect(list.some((t) => t.name === 'org_note_append')).toBe(false);
  });
  it('changes the fingerprint once the surface is adopted', () => {
    expect(fingerprint(tools({ require_brief: false }))).not.toBe(fingerprint(tools(undefined)));
  });
});

describe('typed brief fields (opted in)', () => {
  const org = () => tools({ require_brief: false });
  const orgTask = (list = org()) => list.find((t) => t.name === 'org_task')!;

  it('adds objective, output, tools, boundaries and acceptance to org_task and org_plan_graph nodes', () => {
    const list = org();
    for (const f of FIELDS) expect(Object.keys(orgTask(list).schema)).toContain(f);
    const planSchema = z.object(list.find((t) => t.name === 'org_plan_graph')!.schema as z.ZodRawShape);
    const node = { name: 'a', title: 'A', assignee: 'dev', objective: 'o', acceptance: 'a' };
    expect(planSchema.safeParse({ tasks: [node] }).success).toBe(true);
  });

  it('renders the typed fields and the free text into one brief, delivered through the existing argument', async () => {
    const createTask = vi.fn(() => '{"id":"t1"}');
    const t = orgTask(tools({ require_brief: false }, { createTask }));
    await t.handler({ title: 'Fix', assignee: 'dev', deps: [], objective: 'Stop the flake', output: 'a patch', tools: 'vitest', boundaries: 'only forwarder.ts', acceptance: 'vitest exits 0', brief: 'It fails on retry 3.' });
    const brief = createTask.mock.calls[0][5] as string;
    expect(brief).toBe(
      'Objective: Stop the flake\nOutput: a patch\nTools: vitest\nBoundaries: only forwarder.ts\nAcceptance: vitest exits 0\n\nIt fails on retry 3.',
    );
  });

  it('leaves a brief with no typed fields exactly as written', async () => {
    const createTask = vi.fn(() => '{"id":"t1"}');
    await orgTask(tools({ notes: true }, { createTask })).handler({ title: 'Fix', assignee: 'dev', deps: [], brief: 'plain' });
    expect(createTask.mock.calls[0][5]).toBe('plain');
  });

  it('without require_brief a missing objective or acceptance is a warning, not a rejection', async () => {
    const createTask = vi.fn(() => '{"id":"t1"}');
    const r = await orgTask(tools({ notes: true }, { createTask })).handler({ title: 'Fix', assignee: 'dev', deps: [] });
    expect(createTask).toHaveBeenCalled();
    const out = JSON.parse(r.text);
    expect(out.id).toBe('t1');
    expect(out.warnings.join()).toMatch(/objective/);
    expect(out.warnings.join()).toMatch(/acceptance/);
  });

  describe('require_brief', () => {
    const strict = (createTask = vi.fn(() => '{"id":"t1"}')) => orgTask(tools({ require_brief: true }, { createTask }));
    it('rejects a task missing objective or acceptance, creating nothing', async () => {
      const createTask = vi.fn(() => '{"id":"t1"}');
      const t = strict(createTask);
      for (const missing of ['objective', 'acceptance']) {
        const args: Record<string, unknown> = { title: 'Fix', assignee: 'dev', deps: [], objective: 'o', acceptance: 'a' };
        delete args[missing];
        const out = JSON.parse((await t.handler(args)).text);
        expect(out.error).toMatch(new RegExp(missing));
      }
      expect(createTask).not.toHaveBeenCalled();
    });
    it('accepts a task with both, and warns about the other missing fields', async () => {
      const out = JSON.parse((await strict().handler({ title: 'Fix', assignee: 'dev', deps: [], objective: 'o', acceptance: 'a' })).text);
      expect(out.id).toBe('t1');
      expect(out.warnings.join()).toMatch(/output/);
      expect(out.warnings.join()).toMatch(/boundaries/);
    });
    it('treats a blank objective as missing', async () => {
      const out = JSON.parse((await strict().handler({ title: 'Fix', assignee: 'dev', deps: [], objective: '   ', acceptance: 'a' })).text);
      expect(out.error).toMatch(/objective/);
    });
  });

  it('rejects a rendered brief over the limit instead of truncating it', async () => {
    const createTask = vi.fn(() => '{"id":"t1"}');
    const t = orgTask(tools({ require_brief: false }, { createTask }));
    const out = JSON.parse((await t.handler({ title: 'Fix', assignee: 'dev', deps: [], objective: 'x'.repeat(2500), acceptance: 'y'.repeat(1400), brief: 'z'.repeat(400) })).text);
    expect(out.error).toMatch(new RegExp(`over ${MAX_TASK_BRIEF}`));
    expect(createTask).not.toHaveBeenCalled();
  });

  it('org_plan_graph rejects the whole call when any task fails, naming it, and creates nothing', async () => {
    const planGraph = vi.fn(() => '{"created":2}');
    const plan = tools({ require_brief: true }, { planGraph }).find((t) => t.name === 'org_plan_graph')!;
    const good = { name: 'a', title: 'A', assignee: 'dev', after: [], objective: 'o', acceptance: 'a' };
    const bad = { name: 'b', title: 'B', assignee: 'dev', after: ['a'], objective: 'o' };
    const out = JSON.parse((await plan.handler({ tasks: [good, bad] })).text);
    expect(out.error).toMatch(/"b".*acceptance/);
    expect(planGraph).not.toHaveBeenCalled();
  });

  it('org_plan_graph passes each task its rendered brief and surfaces warnings', async () => {
    const planGraph = vi.fn(() => '{"created":1}');
    const plan = tools({ require_brief: true }, { planGraph }).find((t) => t.name === 'org_plan_graph')!;
    const out = JSON.parse((await plan.handler({ tasks: [{ name: 'a', title: 'A', assignee: 'dev', after: [], objective: 'o', acceptance: 'a' }] })).text);
    const specs = planGraph.mock.calls[0][1] as { brief: string; objective?: string }[];
    expect(specs[0].brief).toBe('Objective: o\nAcceptance: a');
    expect('objective' in specs[0]).toBe(false); // folded into the one brief
    expect(out.created).toBe(1);
    expect(out.warnings.join()).toMatch(/"a"/);
  });
});
