// packages/@monomind/cli/__tests__/orgrt/tool-providers.test.ts
/**
 * M1 — role tool providers (capability `org-tool-providers`).
 *
 * The integration tests run a REAL OrgDaemon whose role declares a stdio MCP
 * provider — a tiny node script written into a temp dir — and a scripted
 * AgentRunner that calls the provider tools through the same `canUseTool` +
 * OrgToolDef.handler path every runner uses.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../src/orgrt/agent-runner.js';
import { checkApproval } from '../../src/orgrt/approvals.js';
import type { OrgBus } from '../../src/orgrt/bus.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import {
  freshChainId,
  jsonSchemaToZodShape,
  mapToolResult,
  parseTraceLine,
} from '../../src/orgrt/tool-providers.js';
import { OrgDefSchema, type BusEvent } from '../../src/orgrt/types.js';

const SERVER_SCRIPT = `
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';
const LOG = process.env.PROVIDER_LOG;
const log = (s) => { if (LOG) appendFileSync(LOG, s + '\\n'); };
log('start ' + process.pid);
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const tools = [
  { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: {
      text: { type: 'string' }, n: { type: 'integer' }, mode: { enum: ['a', 'b'] },
      tags: { type: 'array', items: { type: 'string' } }, opts: { type: 'object', properties: { loud: { type: 'boolean' } } },
      weird: { type: 'frobnicate' } }, required: ['text'] } },
  { name: 'whoami', description: 'Report pid, _meta and env', inputSchema: { type: 'object', properties: {} } },
  { name: 'crash', description: 'Exit the process', inputSchema: { type: 'object', properties: {} } },
  { name: 'fail', description: 'Return an error result', inputSchema: { type: 'object', properties: {} } },
  { name: 'hidden', description: 'Not in allow', inputSchema: { type: 'object', properties: {} } },
];
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } });
  } else if (msg.method === 'notifications/initialized') {
    log('initialized ' + process.pid);
  } else if (msg.method === 'tools/list') {
    log('list ' + process.pid);
    send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: a, _meta } = msg.params;
    log('call ' + name + ' ' + process.pid);
    if (name === 'echo') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + a.text + ':' + (a.n ?? '') }] } });
    else if (name === 'whoami') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ pid: process.pid, meta: _meta, env: {
      name: process.env.MONOMIND_ORG_NAME, run: process.env.MONOMIND_ORG_RUN, role: process.env.MONOMIND_ORG_ROLE,
      root: process.env.MONOMIND_ORG_ROOT, foo: process.env.FOO } }) }] } });
    else if (name === 'crash') process.exit(3);
    else if (name === 'fail') send({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'bad input' }, { type: 'image', data: '', mimeType: 'image/png' }] } });
    else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown tool ' + name } });
  } else if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no' } });
  }
});
`;

/** Scripted runner: every mailbox message containing `CALL <tool> <json>`
 *  calls that tool through canUseTool (as the Claude runner names it) + the
 *  OrgToolDef handler and records the text. */
class ScriptRunner implements AgentRunner {
  tools: OrgToolDef[] = [];
  results: string[] = [];
  private waiters: Array<(t: string) => void> = [];
  async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
    this.tools = args.tools;
    for await (const m of args.prompt as AsyncIterable<{ message: { content: string } }>) {
      const content = String(m.message.content);
      const match = /CALL (\S+) (\{.*\})/.exec(content);
      if (match) {
        const input = JSON.parse(match[2]) as Record<string, unknown>;
        const tool = args.tools.find((t) => t.name === match[1]);
        const decision = (await args.canUseTool?.(`mcp__org__${match[1]}`, input)) as
          | { behavior: string; message?: string }
          | undefined;
        let text: string;
        if (decision?.behavior === 'deny') text = `DENIED ${decision.message}`;
        else text = tool ? (await tool.handler(input)).text : 'NO SUCH TOOL';
        this.results.push(text);
        this.waiters.shift()?.(text);
      }
      yield { type: 'assistant', text: 'ok', session_id: 'sess-1' };
      yield { type: 'result', subtype: 'success', input_tokens: 1, output_tokens: 1, session_id: 'sess-1' };
    }
  }
  next(): Promise<string> {
    return new Promise((r) => this.waiters.push(r));
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor(fn: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('tool providers — pure helpers', () => {
  it('converts an inputSchema into a typed zod shape honouring required', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        text: { type: 'string' },
        n: { type: 'integer' },
        ratio: { type: 'number' },
        ok: { type: 'boolean' },
        mode: { enum: ['a', 'b'] },
        tags: { type: 'array', items: { type: 'string' } },
        opts: { type: 'object', properties: { loud: { type: 'boolean' } }, required: ['loud'] },
        weird: { type: 'frobnicate' },
      },
      required: ['text', 'mode'],
    });
    const obj = z.object(shape);
    expect(obj.safeParse({ text: 'x', mode: 'a' }).success).toBe(true);
    expect(obj.safeParse({ mode: 'a' }).success).toBe(false); // required text
    expect(obj.safeParse({ text: 'x' }).success).toBe(false); // required mode
    expect(obj.safeParse({ text: 'x', mode: 'c' }).success).toBe(false); // enum
    expect(obj.safeParse({ text: 'x', mode: 'a', n: 1.5 }).success).toBe(false); // integer
    expect(obj.safeParse({ text: 'x', mode: 'a', ratio: 1.5, ok: true }).success).toBe(true);
    expect(obj.safeParse({ text: 'x', mode: 'a', tags: [1] }).success).toBe(false);
    expect(obj.safeParse({ text: 'x', mode: 'a', opts: {} }).success).toBe(false);
    expect(obj.safeParse({ text: 'x', mode: 'a', weird: { anything: 1 } }).success).toBe(true); // unknown → any
  });

  it('maps MCP results: text joined, non-text omitted, isError prefixed', () => {
    expect(
      mapToolResult({
        content: [
          { type: 'text', text: 'a' },
          { type: 'image', data: '' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('a\n[image omitted]\nb');
    expect(mapToolResult({ isError: true, content: [{ type: 'text', text: 'boom' }] })).toBe(
      'ERROR: boom',
    );
  });

  it('parses trace lines and mints fresh chain ids', () => {
    expect(parseTraceLine('[trace chn_abc_1-2 hop=3]\nbody')).toEqual({ chain_id: 'chn_abc_1-2', hop: 3 });
    expect(parseTraceLine('[message from x] subject: s\n\n[trace chn_z hop=0]\nhi')).toEqual({
      chain_id: 'chn_z',
      hop: 0,
    });
    expect(parseTraceLine('no trace here')).toBeUndefined();
    expect(freshChainId()).toMatch(/^chn_[a-z0-9]{20}$/);
  });

  it('schema: tool_providers defaults, approvalTools, and passthrough', () => {
    const def = OrgDefSchema.parse({
      name: 'o',
      roles: [
        {
          id: 'lead',
          reports_to: null,
          policy: { approvalTools: ['monoagent__automation_x'] },
          tool_providers: [{ kind: 'mcp-stdio', name: 'mono-agent', command: 'x', extra: 1 }],
        },
      ],
    });
    const p = def.roles[0].tool_providers![0];
    expect(p).toMatchObject({ args: [], env: {}, timeout_ms: 660_000, idle_ms: 300_000, extra: 1 });
    expect(def.roles[0].policy?.approvalTools).toEqual(['monoagent__automation_x']);
    expect(() =>
      OrgDefSchema.parse({
        name: 'o',
        roles: [{ id: 'lead', tool_providers: [{ kind: 'mcp-stdio', name: 'Bad Name', command: 'x' }] }],
      }),
    ).toThrow();
  });

  it('policy: allowTools exempts provider prefixes (bare names), denyTools matches bare form', async () => {
    const events: BusEvent[] = [];
    const bus = { emit: (e: BusEvent) => (events.push(e), e) } as unknown as OrgBus;
    const policy = new PolicyEngine('lead', { allowTools: ['Read'], denyTools: ['monoagent__nope'] }, bus, tmpdir());
    policy.setToolContext({
      providerPrefixes: () => ['monoagent__'],
      trace: () => ({ chain_id: 'chn_t', hop: 4 }),
    });
    expect((await policy.decide('monoagent__automation_x', {})).behavior).toBe('allow');
    expect((await policy.decide('other__automation_x', {})).behavior).toBe('deny');
    expect((await policy.decide('mcp__org__monoagent__nope', {})).behavior).toBe('deny');
    expect(events[0].data).toMatchObject({ chain_id: 'chn_t', hop: 4 });
    policy.updatePolicy({ allowTools: ['Read', 'other__automation_x'] });
    expect((await policy.decide('other__automation_x', {})).behavior).toBe('allow');
  });

  it('approvalTools makes a provider tool sensitive; autoApproveTools still wins', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'tp-appr-'));
    const mk = (policy: Record<string, unknown>) =>
      ({
        root: cwd,
        approvals: new Map(),
        approvalLocks: new Map(),
        orgs: new Map([
          ['o', { def: { roles: [{ id: 'lead', policy }] }, bus: { emit: () => ({}) } }],
        ]),
      }) as unknown as OrgDaemon;
    const gated = mk({ approvalTools: ['monoagent__automation_x'] });
    expect(await checkApproval(gated, 'o', 'lead', 'mcp__org__monoagent__automation_x', { a: 1 })).toBeNull();
    expect(gated.approvals.get('o')?.[0]).toMatchObject({ action: 'monoagent__automation_x', approved: null });
    expect(await checkApproval(gated, 'o', 'lead', 'monoagent__automation_y', {})).toBe(true);
    const trusted = mk({
      approvalTools: ['monoagent__automation_x'],
      autoApproveTools: ['monoagent__automation_x'],
    });
    expect(await checkApproval(trusted, 'o', 'lead', 'monoagent__automation_x', {})).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe('tool providers — real stdio MCP provider in a running org', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function setup(provider: Record<string, unknown>, extraRole: Record<string, unknown> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'tp-org-'));
    const script = join(root, 'provider.mjs');
    writeFileSync(script, SERVER_SCRIPT);
    const logFile = join(root, 'provider.log');
    writeFileSync(logFile, '');
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    const def = {
      name: 'growth',
      goal: 'g',
      roles: [
        {
          id: 'lead',
          title: 'Lead',
          type: 'boss',
          reports_to: null,
          tool_providers: [
            {
              kind: 'mcp-stdio',
              name: 'test-prov',
              command: process.execPath,
              args: [script],
              env: { FOO: 'bar', PROVIDER_LOG: logFile },
              allow: ['echo', 'whoami', 'crash', 'fail'],
              ...provider,
            },
          ],
          ...extraRole,
        },
      ],
    };
    writeFileSync(join(root, '.monomind/orgs/growth.json'), JSON.stringify(def));
    const runner = new ScriptRunner();
    const daemon = new OrgDaemon(root, { runner, forward: false });
    const running = await daemon.startOrg('growth');
    cleanups.push(async () => {
      await daemon.stopAll();
      rmSync(root, { recursive: true, force: true });
    });
    await waitFor(() => runner.tools.length > 0);
    const call = async (tool: string, input: Record<string, unknown>, prefix = '') => {
      const p = runner.next();
      await daemon.deliver('growth', 'human', 'lead', 'call', `${prefix}CALL ${tool} ${JSON.stringify(input)}`);
      return p;
    };
    const logLines = () => readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    return { root, daemon, running, runner, call, logLines, def };
  }

  it('lists provider tools with the prefix, types args, returns results, passes trace meta and env', async () => {
    const { daemon, running, runner, call, logLines, root } = await setup({ idle_ms: 60_000 });
    const names = runner.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['test_prov__echo', 'test_prov__whoami', 'org_send']));
    expect(names).not.toContain('test_prov__hidden'); // allow filter

    const echo = runner.tools.find((t) => t.name === 'test_prov__echo')!;
    const schema = z.object(echo.schema);
    expect(schema.safeParse({ text: 'hi' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ text: 'hi', n: 'x' }).success).toBe(false);
    expect(echo.description).toBe('Echo the text back');

    // listing happened in its own short-lived process, before any call
    const listLines = logLines().filter((l) => l.startsWith('list '));
    expect(listLines).toHaveLength(1);
    expect(logLines().some((l) => l.startsWith('call '))).toBe(false); // lazy: no call process yet

    expect(await call('test_prov__echo', { text: 'hello', n: 2 })).toBe('echo:hello:2');
    expect(await call('test_prov__fail', {})).toBe('ERROR: bad input\n[image omitted]');

    const who1 = JSON.parse(await call('test_prov__whoami', {}, '[trace chn_abcDEF_12 hop=2]\n'));
    expect(who1.meta.trace).toEqual({
      org: 'growth',
      run: running.run,
      role: 'lead',
      chain_id: 'chn_abcDEF_12',
      hop: 2,
      turn: expect.any(Number),
    });
    expect(who1.env).toEqual({ name: 'growth', run: running.run, role: 'lead', root, foo: 'bar' });
    // the list process was a different, already-exited process
    const listPid = Number(listLines[0].split(' ')[1]);
    expect(listPid).not.toBe(who1.pid);
    expect(alive(listPid)).toBe(false);

    // the policy `tool` event for that call carries the chain id
    await waitFor(() =>
      running
        .busEvents()
        .some((e) => e.type === 'tool' && e.tool === 'mcp__org__test_prov__whoami' && e.data?.chain_id === 'chn_abcDEF_12'),
    );
    const toolEvt = running
      .busEvents()
      .find((e) => e.type === 'tool' && e.tool === 'mcp__org__test_prov__whoami' && e.data?.chain_id === 'chn_abcDEF_12');
    expect(toolEvt?.data?.hop).toBe(2);

    // one call process reused for every call
    const callPids = new Set(logLines().filter((l) => l.startsWith('call ')).map((l) => l.split(' ')[2]));
    expect(callPids.size).toBe(1);

    // stopOrg kills the provider process
    await daemon.stopOrg('growth');
    await waitFor(() => !alive(who1.pid));
  }, 30_000);

  it('a role with no trace line gets a fresh chain (hop 0), stable across calls', async () => {
    const { call } = await setup({ idle_ms: 60_000 });
    const a = JSON.parse(await call('test_prov__whoami', {}));
    const b = JSON.parse(await call('test_prov__whoami', {}));
    expect(a.meta.trace.chain_id).toMatch(/^chn_[a-z0-9]{20}$/);
    expect(a.meta.trace.hop).toBe(0);
    expect(b.meta.trace.chain_id).toBe(a.meta.trace.chain_id);
  }, 30_000);

  it('exits after idle_ms without calls and respawns on the next call', async () => {
    const { call, logLines } = await setup({ idle_ms: 300 });
    const first = JSON.parse(await call('test_prov__whoami', {}));
    await waitFor(() => !alive(first.pid), 5000);
    const second = JSON.parse(await call('test_prov__whoami', {}));
    expect(second.pid).not.toBe(first.pid);
    // idle exit is not a crash — tools/list is still not re-run (cached per config)
    expect(logLines().filter((l) => l.startsWith('list '))).toHaveLength(1);
  }, 30_000);

  it('restarts once after a crash, then reports the provider unavailable', async () => {
    const { call, running } = await setup({ idle_ms: 60_000 });
    expect(await call('test_prov__echo', { text: 'a' })).toBe('echo:a:');
    expect(await call('test_prov__crash', {})).toMatch(/^ERROR: tool provider test-prov unavailable: process exited/);
    expect(await call('test_prov__echo', { text: 'b' })).toBe('echo:b:'); // restarted once
    expect(await call('test_prov__crash', {})).toMatch(/^ERROR: tool provider test-prov unavailable/);
    expect(await call('test_prov__echo', { text: 'c' })).toMatch(
      /^ERROR: tool provider test-prov unavailable: process exited \(code 3\)/,
    );
    expect(running.busEvents().filter((e) => e.reason === 'tool-provider-crashed')).toHaveLength(2);
  }, 30_000);

  it('approvalTools gates a provider tool call and the idle watchdog is held while it is pending', async () => {
    const { call, daemon, running } = await setup(
      { idle_ms: 60_000 },
      { policy: { approvalTools: ['test_prov__echo'] } },
    );
    const denied = await call('test_prov__echo', { text: 'x' });
    expect(denied).toMatch(/pending human approval/);
    expect(daemon.approvals.get('growth')?.some((a) => a.action === 'test_prov__echo' && a.approved === null)).toBe(true);
    expect(running.busEvents().some((e) => e.type === 'question' && e.data?.action === 'test_prov__echo')).toBe(true);
  }, 30_000);

  it('reloadOrgDef applies tool_providers/policy changes to an existing role', async () => {
    const { daemon, running, root, def } = await setup({ idle_ms: 60_000 });
    const next = structuredClone(def) as typeof def & { roles: Array<Record<string, unknown>> };
    next.roles[0].policy = { denyTools: ['test_prov__echo'] };
    (next.roles[0].tool_providers as Array<Record<string, unknown>>)[0].allow = ['echo'];
    writeFileSync(join(root, '.monomind/orgs/growth.json'), JSON.stringify(next));
    const res = daemon.reloadOrgDef('growth');
    expect(res.changed).toEqual(expect.arrayContaining(['role:lead:tool_providers', 'role:lead:policy']));
    expect(running.def.roles[0].tool_providers?.[0].allow).toEqual(['echo']);
    expect(running.agents.get('lead')?.policy.policy.denyTools).toEqual(['test_prov__echo']);
    expect((await running.agents.get('lead')!.policy.decide('mcp__org__test_prov__echo', {})).behavior).toBe('deny');
    // budget ceiling derived at spawn survives the policy swap
    expect(running.agents.get('lead')?.policy.policy.maxTokens).toBeGreaterThan(0);
    // unchanged reload reports nothing for the role
    expect(daemon.reloadOrgDef('growth').changed.filter((c) => c.startsWith('role:'))).toEqual([]);
  }, 30_000);
});

describe('idle watchdog — pending approvals are a legitimate wait (C-41)', () => {
  it('does not nudge or stop an org whose role waits on a pending approval', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tp-wd-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(
      join(root, '.monomind/orgs/w.json'),
      JSON.stringify({
        name: 'w',
        goal: 'g',
        run_config: { idle_minutes: 0.005 }, // 300 ms
        roles: [{ id: 'boss', type: 'boss', reports_to: null }],
      }),
    );
    const quiet = ({ prompt }: any) =>
      (async function* () {
        for await (const _m of prompt) {
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    const daemon = new OrgDaemon(root, { queryFn: quiet as any, forward: false });
    const running = await daemon.startOrg('w');
    try {
      expect(await checkApproval(daemon, 'w', 'boss', 'Bash', { command: 'ls' })).toBeNull();
      await new Promise((r) => setTimeout(r, 1500));
      const reasons = running.busEvents().map((e) => e.reason);
      expect(reasons).not.toContain('idle-nudge');
      expect(reasons).not.toContain('idle-stop');
      expect(daemon.getOrg('w')).toBeDefined();
    } finally {
      await daemon.stopAll();
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
