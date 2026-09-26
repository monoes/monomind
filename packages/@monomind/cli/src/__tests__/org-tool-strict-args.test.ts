/**
 * Built-in org tools reject argument keys they do not declare. The 2.16.7
 * release run's captain passed org_plan_graph nodes `deps` (org_task's field)
 * instead of `after`; zod stripped the key, every node came back ready, and
 * QA was dispatched before the build. Tool-provider tools keep their own
 * rules (#325) and are covered by tool-providers tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ClaudeAgentRunner } from '../orgrt/agent-runner.js';
import type { OrgBus } from '../orgrt/bus.js';
import type { Mailbox } from '../orgrt/mailbox.js';
import type { PolicyEngine } from '../orgrt/policy.js';
import { buildOrgTools, type SessionOpts } from '../orgrt/session.js';
import { executeToolCall } from '../orgrt/tool-fence.js';
import type { OrgDef, OrgRole } from '../orgrt/types.js';

const role = { id: 'boss', title: 'Boss', type: 'coordinator' } as unknown as OrgRole;

function orgTools(over: Partial<SessionOpts> = {}) {
  const opts = {
    org: 'acme',
    role,
    bus: {} as OrgBus,
    policy: {} as PolicyEngine,
    mailbox: {} as Mailbox,
    cwd: '/work',
    def: { name: 'acme', goal: 'g', roles: [role], run_config: {} } as unknown as OrgDef,
    deliver: vi.fn(async () => 'delivered'),
    askHuman: async () => 'ok',
    createTask: vi.fn(() => 'created'),
    completeTask: vi.fn(() => 'done'),
    splitTask: vi.fn(() => 'split'),
    planGraph: vi.fn(() => 'planned'),
    ...over,
  } as unknown as SessionOpts;
  return { opts, tools: buildOrgTools(opts) };
}

const call = (tools: ReturnType<typeof buildOrgTools>, name: string, args: unknown) =>
  executeToolCall(tools, { name, arguments: args as Record<string, unknown> });

describe('built-in org tools reject unknown argument keys', () => {
  it('org_plan_graph: a node carrying `deps` is refused with a pointer to `after`', async () => {
    const { opts, tools } = orgTools();
    const out = await call(tools, 'org_plan_graph', {
      tasks: [
        { name: 'build_r1', title: 'build', assignee: 'boss' },
        { name: 'qa_r1', title: 'qa', assignee: 'boss', deps: ['build_r1'] },
      ],
    });
    expect(out).toMatch(/^ERROR/);
    expect(out).toContain('deps');
    expect(out).toContain('`after`');
    expect(opts.planGraph).not.toHaveBeenCalled();
  });

  it('org_task: `after` is refused with a pointer to `deps`', async () => {
    const { opts, tools } = orgTools();
    const out = await call(tools, 'org_task', { title: 't', assignee: 'boss', after: ['x'] });
    expect(out).toMatch(/^ERROR/);
    expect(out).toContain('after');
    expect(out).toContain('`deps`');
    expect(opts.createTask).not.toHaveBeenCalled();
  });

  it('an unknown top-level key on another org tool is refused and named', async () => {
    const { opts, tools } = orgTools();
    const out = await call(tools, 'org_send', { to: 'dev', subject: 's', message: 'm', cc: 'x' });
    expect(out).toMatch(/^ERROR/);
    expect(out).toContain('"cc"');
    expect(opts.deliver).not.toHaveBeenCalled();
  });

  it('nested objects are strict too (org_task_done evidence checks)', async () => {
    const { opts, tools } = orgTools();
    const out = await call(tools, 'org_task_done', {
      taskId: 't1',
      evidence: { headSha: 'abc', checks: [{ command: 'x', exitCode: 0, exit: 0 }] },
    });
    expect(out).toMatch(/^ERROR/);
    expect(out).toContain('"exit"');
    expect(opts.completeTask).not.toHaveBeenCalled();
  });

  it('valid calls are unchanged', async () => {
    const { opts, tools } = orgTools();
    expect(
      await call(tools, 'org_plan_graph', {
        tasks: [
          { name: 'a', title: 'A', assignee: 'boss' },
          { name: 'b', title: 'B', assignee: 'boss', after: ['a'] },
        ],
      }),
    ).toBe('planned');
    expect(opts.planGraph).toHaveBeenCalledWith('boss', [
      { name: 'a', title: 'A', assignee: 'boss', after: [] },
      { name: 'b', title: 'B', assignee: 'boss', after: ['a'] },
    ]);
    expect(await call(tools, 'org_task', { title: 't', assignee: 'boss', deps: ['a'] })).toBe(
      'created',
    );
    expect(opts.createTask).toHaveBeenCalledWith('boss', 't', 'boss', ['a'], undefined, undefined);
    expect(await call(tools, 'org_send', { to: 'dev', subject: 's', message: 'm' })).toBe(
      'delivered',
    );
  });
});

describe('ClaudeAgentRunner exposes and enforces strict org tool schemas', () => {
  async function orgServer() {
    const { tools } = orgTools();
    let server: any;
    const fakeQuery = ({ options }: any) =>
      (async function* () {
        server = options.mcpServers.org;
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    const runner = new ClaudeAgentRunner(fakeQuery as any);
    for await (const _ of runner.run({
      tools,
      prompt: (async function* () {})(),
      systemPrompt: '',
      cwd: '/work',
    } as any)) {
      // drain
    }
    const handlers = server.instance.server._requestHandlers;
    const extra = {
      signal: new AbortController().signal,
      sendNotification: async () => {},
      sendRequest: async () => {},
      requestId: 1,
    };
    return {
      list: () => handlers.get('tools/list')({ method: 'tools/list', params: {} }, extra),
      call: (name: string, args: unknown) =>
        handlers.get('tools/call')(
          { method: 'tools/call', params: { name, arguments: args, _meta: { progressToken: 7 } } },
          extra,
        ),
    };
  }

  it('advertises additionalProperties: false at the top level and on plan_graph nodes', async () => {
    const srv = await orgServer();
    const { tools } = await srv.list();
    const plan = tools.find((t: any) => t.name === 'org_plan_graph');
    expect(plan.inputSchema.additionalProperties).toBe(false);
    expect(plan.inputSchema.properties.tasks.items.additionalProperties).toBe(false);
    for (const t of tools) expect(t.inputSchema.additionalProperties).toBe(false);
  });

  it('returns the hint to the model and still accepts MCP `_meta`', async () => {
    const srv = await orgServer();
    const bad = await srv.call('org_plan_graph', {
      tasks: [{ name: 'qa', title: 'qa', assignee: 'boss', deps: ['build'] }],
    });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('`after`');
    const ok = await srv.call('org_plan_graph', {
      tasks: [{ name: 'qa', title: 'qa', assignee: 'boss' }],
    });
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0].text).toBe('planned');
  });
});

describe('tools without `strict` keep their old key handling', () => {
  it('a catchall (provider) tool keeps unlisted keys; a plain one strips them', async () => {
    const seen: Record<string, unknown>[] = [];
    const handler = async (a: Record<string, unknown>) => {
      seen.push(a);
      return { text: 'ok' };
    };
    const tools = [
      { name: 'p', description: '', schema: { a: z.string() }, catchall: z.unknown(), handler },
      { name: 'q', description: '', schema: { a: z.string() }, handler },
    ];
    expect(await call(tools, 'p', { a: '1', extra: 2 })).toBe('ok');
    expect(await call(tools, 'q', { a: '1', extra: 2 })).toBe('ok');
    expect(seen).toEqual([{ a: '1', extra: 2 }, { a: '1' }]);
  });
});
