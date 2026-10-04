/**
 * Limited (scoped) cline turns refuse tool calls that need approval instead
 * of approving them, and never wait for an answer (cline-runner-scoped.ts).
 * Fixture provenance: __tests__/orgrt/cline/fake-cline.ts.
 */
import * as cp from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentRunArgs } from '../../src/orgrt/agent-runner.js';
import { ClineAgentRunner, endedOnRefusals } from '../../src/orgrt/cline-runner.js';
import {
  acpPermissionOutcome,
  CLINE_SAFE_TOOLS,
  editAllowedInWorkspace,
  isClineRefusal,
  SCOPED_PLUGIN_FILE,
  SCOPED_REFUSAL,
  SCOPED_WORKSPACE_ENV,
  scopedPluginSource,
} from '../../src/orgrt/cline-runner-scoped.js';
import { ToolActivityTracker } from '../../src/orgrt/tool-activity.js';
import { acpChild, fakeHost, fixture, jsonChild, SID, successRow } from './cline/fake-cline.js';

// Storage policy is covered by runner-inputs-599.test.ts; these runner unit
// fixtures deliberately use the test worker's isolated temporary HOME.
vi.mock('../../src/orgrt/runner-inputs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orgrt/runner-inputs.js')>();
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  return { ...actual, createRunnerInputDir: (runner: string) => fs.mkdtempSync(path.join(os.tmpdir(), `runner-fixture-${runner}-`)) };
});

vi.mock('node:child_process', async (importOriginal) => ({
  execFileSync: (await importOriginal<typeof import('node:child_process')>()).execFileSync,
  spawn: vi.fn(), execFile: vi.fn(),
}));

const SCOPED = fixture('json-scoped-refused.ndjson');
const ABORTED = fixture('json-refused-aborted.ndjson');
const ACP = fixture('acp-resume.ndjson');

function args(extra: Partial<AgentRunArgs> = {}, prompts: string[] = ['go']): AgentRunArgs {
  return {
    tools: [],
    prompt: (async function* () {
      for (const p of prompts) yield p;
    })(),
    systemPrompt: 'SYS',
    cwd: '/w',
    env: {},
    maxTurns: 25,
    access: 'scoped',
    ...extra,
  };
}

async function collect(it: AsyncIterable<AgentMessage>): Promise<AgentMessage[]> {
  const out: AgentMessage[] = [];
  for await (const m of it) out.push(m);
  return out;
}

const spawned = () => vi.mocked(cp.spawn).mock.calls;
const cliArgs = (argv: readonly string[]) => argv.slice(argv.indexOf('cline') + 1);

beforeEach(() => {
  vi.mocked(cp.spawn).mockReset();
});

describe('scoped json turn', () => {
  it('runs --auto-approve false with the refusal plugin in the scoped config dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cline-scoped-test-'));
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SCOPED));
    const prev = process.env.CLINE_TOOL_APPROVAL_MODE;
    process.env.CLINE_TOOL_APPROVAL_MODE = 'desktop';
    try {
      await collect(new ClineAgentRunner('cline', fakeHost({ scopedDir: dir })).run(args()));
    } finally {
      if (prev === undefined) delete process.env.CLINE_TOOL_APPROVAL_MODE;
      else process.env.CLINE_TOOL_APPROVAL_MODE = prev;
    }
    const [, argv, opts] = spawned()[0];
    expect(cliArgs(argv as string[]).slice(0, 4)).toEqual([
      '--json',
      '--act',
      '--auto-approve',
      'false',
    ]);
    expect(argv).toEqual(expect.arrayContaining(['--config', dir]));
    expect(readFileSync(join(dir, 'plugins', SCOPED_PLUGIN_FILE), 'utf8')).toBe(
      scopedPluginSource(),
    );
    // Desktop approval IPC would wait up to 5 minutes for an answer.
    expect((opts as cp.SpawnOptions).env?.CLINE_TOOL_APPROVAL_MODE).toBeUndefined();
  });

  it('full access keeps --auto-approve true and writes no plugin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cline-scoped-test-'));
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SCOPED));
    await collect(
      new ClineAgentRunner('cline', fakeHost({ scopedDir: dir })).run(args({ access: 'full' })),
    );
    expect(cliArgs(spawned()[0][1] as string[]).slice(2, 4)).toEqual(['--auto-approve', 'true']);
    expect(existsSync(join(dir, 'plugins'))).toBe(false);
  });

  it('reports the refused call as denied and finishes the turn normally', async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SCOPED));
    const msgs = await collect(
      new ClineAgentRunner('cline', fakeHost({ histories: [[successRow('x')]] })).run(args()),
    );
    const results = msgs.filter((m) => m.type === 'tool_result');
    expect(results.map((m) => [m.tool, m.is_error, m.denied])).toEqual([
      ['read_files', false, undefined],
      ['run_commands', true, true],
    ]);
    expect(results[1].text).toContain(SCOPED_REFUSAL);
    expect(msgs.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });

    const events: Record<string, unknown>[] = [];
    const tracker = new ToolActivityTracker((e) => events.push(e));
    for (const m of msgs) tracker.onMessage(m);
    expect(events.filter((e) => e.phase === 'end').map((e) => [e.name, e.ok, e.denied])).toEqual([
      ['read_files', true, undefined],
      ['run_commands', false, true],
    ]);
  });

  it("does not fail a turn cline's mistake limit ended after refusals", async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(ABORTED));
    const msgs = await collect(new ClineAgentRunner('cline', fakeHost()).run(args()));
    const results = msgs.filter((m) => m.type === 'tool_result');
    expect(results.map((m) => [m.tool, m.denied])).toEqual([
      ['read_files', true],
      ['ask_question', true],
      ['run_commands', true],
    ]);
    expect(msgs.some((m) => m.type === 'assistant' && /refused tool calls/.test(m.text ?? ''))).toBe(
      true,
    );
    expect(msgs.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });
});

describe('endedOnRefusals', () => {
  const o = (finishReason: string) => ({
    exitCode: 0,
    stderrTail: '',
    timedOut: false,
    maxTurnsHit: false,
    finishReason,
  });
  it('only a stop right after a refusal counts', () => {
    expect(endedOnRefusals(o('aborted'), true)).toBe(true);
    expect(endedOnRefusals(o('cancelled'), true)).toBe(true);
    expect(endedOnRefusals(o('aborted'), false)).toBe(false);
    expect(endedOnRefusals(o('error'), true)).toBe(false);
    expect(endedOnRefusals({ ...o('aborted'), timedOut: true }, true)).toBe(false);
  });
});

describe('scoped ACP turn', () => {
  const PERMISSION_ID = 900;
  const toolCall = (id: string, title: string, kind: string, rawInput: unknown) => ({
    toolCallId: id,
    title,
    kind,
    status: 'pending',
    rawInput,
  });
  const options = [
    { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'allow_always', name: 'Allow always', kind: 'allow_always' },
    { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
  ];
  // The live resume fixture up to session/load's answer, then a prompt whose
  // run_commands call asks for permission (request shape from cline
  // 3.0.65's acp permission code), fails twice (the rejection's own update,
  // then the tool result), and the turn ends.
  const loadEnd = ACP.findIndex((l) => JSON.parse(l).id === 2);
  const update = (u: Record<string, unknown>) =>
    JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: SID, update: u } });
  const lines = [
    ...ACP.slice(0, loadEnd + 1),
    update({ sessionUpdate: 'tool_call_update', ...toolCall('c1', 'run_commands: rm x', 'execute', { commands: 'rm x' }) }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: PERMISSION_ID,
      method: 'session/request_permission',
      params: { sessionId: SID, toolCall: toolCall('c1', 'run_commands: rm x', 'execute', { commands: 'rm x' }), options },
    }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed' }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed', rawOutput: '{"error":"User rejected the tool call"}' }),
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'not allowed' } }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, result: { stopReason: 'end_turn' } }),
  ];

  it('runs --auto-approve false, rejects the gated call, reports it denied once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cline-scoped-test-'));
    const child = acpChild(lines);
    vi.mocked(cp.spawn).mockReturnValueOnce(child);
    const host = fakeHost({ scopedDir: dir, histories: [[successRow('x')]] });
    const msgs = await collect(
      new ClineAgentRunner('cline', host).run(args({ resume: SID, env: { CLINE_API_KEY: 'k' } })),
    );
    const argv = spawned()[0][1] as string[];
    expect(argv.slice(0, 3)).toEqual(['--acp', '--auto-approve', 'false']);
    expect(argv).toEqual(expect.arrayContaining(['--config', dir]));

    const answer = child.written.map((l) => JSON.parse(l)).find((m) => m.id === PERMISSION_ID);
    expect(answer?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'reject_once' } });

    const uses = msgs.filter((m) => m.type === 'tool_use' && m.tool);
    expect(uses.map((m) => [m.tool_use_id, m.tool, m.kind])).toEqual([['c1', 'run_commands', 'shell']]);
    const results = msgs.filter((m) => m.type === 'tool_result');
    expect(results.map((m) => [m.tool_use_id, m.is_error, m.denied])).toEqual([['c1', true, true]]);
    expect(msgs.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });
});

describe('acpPermissionOutcome', () => {
  const params = (title: string) => ({
    toolCall: { toolCallId: 't', title },
    options: [
      { optionId: 'allow_once', kind: 'allow_once' },
      { optionId: 'reject_once', kind: 'reject_once' },
    ],
  });
  it('scoped: allows the safe tools, rejects the rest', () => {
    expect(acpPermissionOutcome(params('read_files: a.txt'), true)).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
      denied: false,
    });
    for (const t of ['run_commands: ls', 'editor: {}', 'apply_patch: x', 'mcp__srv__tool: {}', 'spawn_agent: x'])
      expect(acpPermissionOutcome(params(t), true)).toEqual({
        outcome: { outcome: 'selected', optionId: 'reject_once' },
        denied: true,
      });
  });
  it('full access allows; no usable option cancels (denied)', () => {
    expect(acpPermissionOutcome(params('run_commands: ls'), false).denied).toBe(false);
    expect(acpPermissionOutcome({ toolCall: { title: 'run_commands: ls' } }, true)).toEqual({
      outcome: { outcome: 'cancelled' },
      denied: true,
    });
  });
});

describe('the refusal plugin module', () => {
  it('re-approves the safe tools and skips everything else with a refusal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cline-plugin-test-'));
    const file = join(dir, 'plugin.mjs');
    writeFileSync(file, scopedPluginSource());
    const plugin = (await import(pathToFileURL(file).href)).default;
    expect(plugin.name).toBe('monomind-scoped');
    expect(plugin.manifest).toEqual({ capabilities: ['hooks'] });
    const call = (toolName: string) => plugin.hooks.beforeTool({ toolCall: { toolName } });
    for (const t of CLINE_SAFE_TOOLS) expect(call(t)).toEqual({ policy: { autoApprove: true } });
    for (const t of ['run_commands', 'editor', 'apply_patch', 'spawn_agent', 'team_task', 'mcp__a__b', '']) {
      const r = call(t);
      expect(r.skip).toBe(true);
      expect(isClineRefusal(r.reason)).toBe(true);
    }
  });

  it('isClineRefusal tells refusals from tool failures', () => {
    expect(isClineRefusal('Tool "x" requires approval in a TTY session -- NOT a tool')).toBe(true);
    expect(isClineRefusal('User rejected the tool call')).toBe(true);
    expect(isClineRefusal('ENOENT: no such file')).toBe(false);
    expect(isClineRefusal(undefined)).toBe(false);
  });
});

describe('limited mode allows file edits inside the project only', () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'cline-ws-')));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'cline-out-')));
  mkdirSync(join(ws, 'src'), { recursive: true });
  symlinkSync(outside, join(ws, 'escape'));
  const patch = (...lines: string[]) => ({ input: ['*** Begin Patch', ...lines, '*** End Patch'].join('\n') });

  it('editAllowedInWorkspace: inside yes; outside, .git, symlink escape, no workspace no', () => {
    expect(editAllowedInWorkspace('editor', { path: 'src/a.ts', new_text: 'x' }, ws)).toBe(true);
    expect(editAllowedInWorkspace('editor', { path: join(ws, 'new/dir/b.ts') }, ws)).toBe(true);
    expect(editAllowedInWorkspace('apply_patch', patch('*** Add File: src/c.ts', '+hi', '*** Update File: README.md'), ws)).toBe(true);
    expect(editAllowedInWorkspace('apply_patch', '*** Begin Patch\n*** Delete File: old.txt\n*** End Patch', ws)).toBe(true);

    expect(editAllowedInWorkspace('editor', { path: '../x.txt' }, ws)).toBe(false);
    expect(editAllowedInWorkspace('editor', { path: join(outside, 'x.txt') }, ws)).toBe(false);
    expect(editAllowedInWorkspace('editor', { path: '/etc/passwd' }, ws)).toBe(false);
    expect(editAllowedInWorkspace('editor', { path: 'escape/x.txt' }, ws)).toBe(false);
    expect(editAllowedInWorkspace('editor', { path: '.git/hooks/pre-commit' }, ws)).toBe(false);
    expect(editAllowedInWorkspace('editor', { path: '.' }, ws)).toBe(false);
    expect(editAllowedInWorkspace('apply_patch', patch('*** Update File: src/a.ts', '*** Move to: ../stolen.ts'), ws)).toBe(false);
    expect(editAllowedInWorkspace('apply_patch', patch('*** Add File: ok.ts', '*** Add File: /tmp/evil.ts'), ws)).toBe(false);
    expect(editAllowedInWorkspace('apply_patch', { input: 'no patch headers' }, ws)).toBe(false);
    expect(editAllowedInWorkspace('editor', {}, ws)).toBe(false);
    expect(editAllowedInWorkspace('editor', { path: 'src/a.ts' }, '')).toBe(false);
    expect(editAllowedInWorkspace('editor', { path: 'src/a.ts' }, 'relative/dir')).toBe(false);
    expect(editAllowedInWorkspace('run_commands', { commands: ['ls'] }, ws)).toBe(false);
  });

  it('the plugin approves project edits and refuses commands and outside edits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cline-plugin-ws-'));
    const file = join(dir, 'plugin.mjs');
    writeFileSync(file, scopedPluginSource());
    const plugin = (await import(pathToFileURL(file).href)).default;
    const prev = process.env[SCOPED_WORKSPACE_ENV];
    process.env[SCOPED_WORKSPACE_ENV] = ws;
    try {
      const call = (toolName: string, input: unknown) => plugin.hooks.beforeTool({ toolCall: { toolName }, input });
      expect(call('editor', { path: 'src/a.ts', new_text: 'x' })).toEqual({ policy: { autoApprove: true } });
      expect(call('apply_patch', patch('*** Add File: src/c.ts', '+hi'))).toEqual({ policy: { autoApprove: true } });
      for (const [t, input] of [
        ['editor', { path: '../x.txt' }],
        ['editor', { path: '.git/config' }],
        ['editor', { path: 'escape/x.txt' }],
        ['apply_patch', patch('*** Add File: /tmp/evil.ts')],
        ['run_commands', { commands: ['echo hi > x.txt'] }],
      ] as const) {
        const r = call(t, input);
        expect(r.skip).toBe(true);
        expect(isClineRefusal(r.reason)).toBe(true);
      }
      delete process.env[SCOPED_WORKSPACE_ENV];
      expect(call('editor', { path: 'src/a.ts' }).skip).toBe(true); // no project folder: fail closed
    } finally {
      if (prev === undefined) delete process.env[SCOPED_WORKSPACE_ENV];
      else process.env[SCOPED_WORKSPACE_ENV] = prev;
    }
  });

  it('ACP permission answers follow the same rule', () => {
    const req = (title: string, rawInput: unknown) => ({
      toolCall: { toolCallId: 't', title, rawInput },
      options: [
        { optionId: 'allow_once', kind: 'allow_once' },
        { optionId: 'reject_once', kind: 'reject_once' },
      ],
    });
    expect(acpPermissionOutcome(req('editor: src/a.ts', { path: 'src/a.ts' }), true, ws).denied).toBe(false);
    expect(acpPermissionOutcome(req('editor: ../x', { path: '../x' }), true, ws).denied).toBe(true);
    expect(acpPermissionOutcome(req('editor: src/a.ts', { path: 'src/a.ts' }), true).denied).toBe(true);
    expect(acpPermissionOutcome(req('run_commands: ls', { commands: ['ls'] }), true, ws).denied).toBe(true);
  });
});
