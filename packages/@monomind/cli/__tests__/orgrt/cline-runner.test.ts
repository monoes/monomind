/**
 * ClineAgentRunner (monomind#382) driven by a fake spawn and a fake host.
 * Fixture provenance: __tests__/orgrt/cline/fake-cline.ts.
 */
import * as cp from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentRunArgs } from '../../src/orgrt/agent-runner.js';
import { CLINE_TURN_ENV } from '../../src/orgrt/cline-runner-host.js';
import { ClineAgentRunner } from '../../src/orgrt/cline-runner.js';
import {
  callerFence,
  expectAllCallsBeforeResults,
  expectCallerRoundTrip,
  rosterResult,
  runFullAccessToolTurn,
} from '../../src/__tests__/caller-tool-turn.js';
import {
  MODEL,
  SID,
  acpChild,
  fakeHost,
  fixture,
  jsonChild,
  successRow,
} from './cline/fake-cline.js';

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

const SUCCESS = fixture('json-success.ndjson');
const PROVIDER_ERROR = fixture('json-provider-error.ndjson');
const ACP = fixture('acp-resume.ndjson');
/** Not a credential: a placeholder the fake never sends anywhere. */
const PLACEHOLDER = ['placeholder', 'value'].join('-');
const OR_KEY_VAR = 'OPENROUTER_API_KEY';

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
    access: 'full',
    ...extra,
  };
}

async function collect(it: AsyncIterable<AgentMessage>): Promise<AgentMessage[]> {
  const out: AgentMessage[] = [];
  for await (const m of it) out.push(m);
  return out;
}

const spawned = () => vi.mocked(cp.spawn).mock.calls;

beforeEach(() => {
  vi.mocked(cp.spawn).mockReset();
});

describe('ClineAgentRunner — fresh json turn', () => {
  it('runs cline --json with the prompt on a FIFO and maps the live stream', async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SUCCESS));
    const host = fakeHost({ histories: [[successRow('x')]] });
    const msgs = await collect(
      new ClineAgentRunner('cline', host).run(args({ model: MODEL, effort: 'high' })),
    );

    const [command, argv, opts] = spawned()[0];
    expect(command).toBe('/bin/sh');
    const cli = argv.slice(argv.indexOf('cline') + 1);
    expect(cli).toEqual([
      '--json',
      '--act',
      '--auto-approve',
      'true',
      '-c',
      '/w',
      '-m',
      MODEL,
      '--thinking',
      'high',
      'Complete the task below.',
    ]);
    expect(argv).not.toContain('--yolo');
    expect(argv).not.toContain('-y');
    expect(argv.join(' ')).not.toContain('SYS'); // the prompt goes through the FIFO
    expect((opts as cp.SpawnOptions).env?.[CLINE_TURN_ENV]).toMatch(/^[0-9a-f-]{36}$/);

    const uses = msgs.filter((m) => m.type === 'tool_use' && m.tool);
    expect(uses.map((m) => [m.tool, m.kind, m.input])).toEqual([
      ['editor', 'write', { file_path: '/w/hello.txt', content: 'hi' }],
      ['run_commands', 'shell', { command: 'cat /w/hello.txt' }],
    ]);
    const results = msgs.filter((m) => m.type === 'tool_result');
    expect(results.map((m) => [m.tool_use_id, m.is_error, m.text])).toEqual([
      [uses[0].tool_use_id, false, 'File created successfully at: /w/hello.txt'],
      [uses[1].tool_use_id, false, 'hi'],
    ]);
    expect(msgs.filter((m) => m.type === 'assistant').map((m) => m.text)).toEqual(['done']);
    expect(msgs.at(-1)).toEqual({
      type: 'result',
      session_id: SID,
      subtype: 'success',
      input_tokens: 19305,
      output_tokens: 201,
      cost_usd: 0,
    });
  });

  it('isolates a scoped turn: --config/--data-dir and an empty MCP settings file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cline-scoped-test-'));
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SUCCESS));
    await collect(
      new ClineAgentRunner('cline', fakeHost({ scopedDir: dir })).run(args({ access: 'scoped' })),
    );
    const [, argv, opts] = spawned()[0];
    expect(argv).toEqual(
      expect.arrayContaining(['--config', dir, '--data-dir', join(dir, 'data')]),
    );
    const env = (opts as cp.SpawnOptions).env ?? {};
    expect(env.CLINE_MCP_SETTINGS_PATH).toBe(join(dir, 'cline_mcp_settings.json'));
    expect(JSON.parse(readFileSync(env.CLINE_MCP_SETTINGS_PATH as string, 'utf8'))).toEqual({
      mcpServers: {},
    });
  });

  it('leaves the user config and MCP untouched under full access', async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SUCCESS));
    await collect(new ClineAgentRunner('cline', fakeHost()).run(args()));
    const [, argv, opts] = spawned()[0];
    expect(argv).not.toContain('--config');
    expect(argv).not.toContain('--data-dir');
    expect((opts as cp.SpawnOptions).env?.CLINE_MCP_SETTINGS_PATH).toBe(
      process.env.CLINE_MCP_SETTINGS_PATH,
    );
    expect((opts as cp.SpawnOptions).detached).toBe(process.platform !== 'win32');
  });

  it('passes CLINE_PROVIDER as -P and maps effort off to --thinking none', async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SUCCESS));
    await collect(
      new ClineAgentRunner('cline', fakeHost()).run(
        args({ env: { CLINE_PROVIDER: 'openrouter' }, effort: 'off' }),
      ),
    );
    const argv = spawned()[0][1] as string[];
    expect(argv.join(' ')).toContain('-P openrouter');
    expect(argv.join(' ')).toContain('--thinking none');
  });

  it('fails the turn with the agent error of a failed run', async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(
      jsonChild(PROVIDER_ERROR, {
        exitCode: 1,
        stderr: '{"ts":"2026-09-29T09:12:19.042Z","type":"error","message":"Provider returned error"}\n',
      }),
    );
    await expect(collect(new ClineAgentRunner('cline', fakeHost()).run(args()))).rejects.toThrow(
      /ClineAgentRunner: Provider returned error/,
    );
  });

  it('names the install when the cline binary is missing', async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(
      jsonChild([], { exitCode: 127, stderr: 'monomind-cline: 1: exec: cline: not found\n' }),
    );
    await expect(collect(new ClineAgentRunner('cline', fakeHost()).run(args()))).rejects.toThrow(
      /npm install -g cline/,
    );
  });

  it('kills the turn past maxTurns (counted iteration_start) and reports error_max_turns', async () => {
    // Live (3.0.65): neither SIGTERM nor SIGINT stops a --json run, so the
    // runner kills the process; nothing more arrives after the kill.
    const upTo = SUCCESS.findIndex((l) => l.includes('"iteration":2'));
    const child = jsonChild(SUCCESS.slice(0, upTo + 1), { hold: true });
    vi.mocked(cp.spawn).mockReturnValueOnce(child);
    const msgs = await collect(new ClineAgentRunner('cline', fakeHost()).run(args({ maxTurns: 1 })));
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(msgs.at(-1)).toMatchObject({ type: 'result', subtype: 'error_max_turns', input_tokens: 6277 });
  });
});

describe('ClineAgentRunner — hub daemon cleanup', () => {
  it('kills the hub daemon the turn started when the turn ends', async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SUCCESS));
    const host = fakeHost({ daemonPid: 4242 });
    await collect(new ClineAgentRunner('cline', host).run(args()));
    await new Promise((r) => setTimeout(r, 20));
    expect(host.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('kills the hub daemon and the turn on abort (Stop)', async () => {
    const child = jsonChild(SUCCESS.slice(0, 3), { hold: true });
    vi.mocked(cp.spawn).mockReturnValueOnce(child);
    const host = fakeHost({ daemonPid: 4343 });
    const ac = new AbortController();
    const run = collect(new ClineAgentRunner('cline', host).run(args({ access: 'scoped', signal: ac.signal })));
    await new Promise((r) => setTimeout(r, 20));
    expect(host.kill).not.toHaveBeenCalled();
    ac.abort();
    await run.catch(() => {});
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(host.kill).toHaveBeenCalledWith(4343, 'SIGTERM');
  });

  it('never kills a daemon that is not a hub daemon', async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SUCCESS));
    const host = fakeHost({ daemonPid: 4444 });
    host.cmdline = () => 'bash -c sleep 100';
    await collect(new ClineAgentRunner('cline', host).run(args()));
    await new Promise((r) => setTimeout(r, 20));
    expect(host.kill).not.toHaveBeenCalled();
  });
});

describe('ClineAgentRunner — resume over ACP', () => {
  const before = successRow('x');
  const after = successRow('x', { inputTokens: 26119, outputTokens: 230 });
  after.metadata = { ...after.metadata, totalCost: 0.0015, usage: { ...after.metadata?.usage, totalCost: 0.0015 } };

  it('loads the session, skips the replay and reports the history usage delta', async () => {
    const child = acpChild(ACP);
    vi.mocked(cp.spawn).mockReturnValueOnce(child);
    const host = fakeHost({ histories: [[before], [after]] });
    const msgs = await collect(
      new ClineAgentRunner('cline', host).run(
        args({ resume: SID, env: { [OR_KEY_VAR]: PLACEHOLDER } }, ['what file?']),
      ),
    );

    const [command, argv, opts] = spawned()[0];
    expect(command).toBe('cline');
    expect(argv).toEqual(['--acp', '--auto-approve', 'true']);
    const env = (opts as cp.SpawnOptions).env ?? {};
    expect(env).toMatchObject({ CLINE_PROVIDER: 'openrouter', CLINE_MODEL: MODEL });
    expect(env.CLINE_API_KEY).toBe(PLACEHOLDER);

    const sent = child.written.map((l) => JSON.parse(l));
    expect(sent.map((m) => m.method)).toEqual(['initialize', 'session/load', 'session/prompt']);
    expect(sent[1].params).toEqual({ sessionId: SID, cwd: '/w', mcpServers: [] });
    expect(sent[2].params.prompt).toEqual([{ type: 'text', text: 'what file?' }]); // no system prompt

    const uses = msgs.filter((m) => m.type === 'tool_use' && m.tool);
    expect(uses.map((m) => [m.tool, m.kind, m.input])).toEqual([['run_commands', 'shell', { command: 'ls' }]]);
    expect(msgs.filter((m) => m.type === 'tool_result').map((m) => m.text)).toEqual(['hello.txt\n']);
    expect(msgs.filter((m) => m.type === 'assistant').map((m) => m.text)).toEqual(['hello.txt']);
    expect(msgs.at(-1)).toEqual({
      type: 'result',
      session_id: SID,
      subtype: 'success',
      input_tokens: 26119 - 19305,
      output_tokens: 230 - 201,
      cost_usd: 0.0015,
    });
  });

  it('continues a fresh session over ACP on the next mailbox message', async () => {
    vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SUCCESS)).mockReturnValueOnce(acpChild(ACP));
    const host = fakeHost({ histories: [[before], [before], [after]] });
    const msgs = await collect(
      new ClineAgentRunner('cline', host).run(
        args({ env: { [OR_KEY_VAR]: PLACEHOLDER } }, ['first', 'second']),
      ),
    );
    expect(spawned().map((c) => c[0])).toEqual(['/bin/sh', 'cline']);
    expect(msgs.filter((m) => m.type === 'result').map((m) => [m.session_id, m.input_tokens])).toEqual([
      [SID, 19305],
      [SID, 6814],
    ]);
  });

  it('fails with the fix named when no key reaches ACP', async () => {
    const host = fakeHost({ histories: [[before]] });
    await expect(
      collect(new ClineAgentRunner('cline', host).run(args({ resume: SID }))),
    ).rejects.toThrow(/export OPENROUTER_API_KEY \(or CLINE_API_KEY\)/);
    expect(spawned()).toHaveLength(0);
  });

  it('reports a session cline cannot load', async () => {
    const lines = [
      ACP[0],
      '{"jsonrpc":"2.0","id":2,"error":{"code":-32002,"message":"Resource not found: nope_1"}}',
    ];
    vi.mocked(cp.spawn).mockReturnValueOnce(acpChild(lines));
    await expect(
      collect(
        new ClineAgentRunner('cline', fakeHost()).run(
          args({ resume: 'nope_1', env: { CLINE_PROVIDER: 'cline' } }),
        ),
      ),
    ).rejects.toThrow(/could not load session nope_1: Resource not found/);
  });

  it('cancels at maxTurns by counting model steps', async () => {
    const child = acpChild(ACP);
    vi.mocked(cp.spawn).mockReturnValueOnce(child);
    const host = fakeHost({ histories: [[before], [after]] });
    // Model steps of the live prompt: text, then (after the ls result) text.
    const msgs = await collect(
      new ClineAgentRunner('cline', host).run(
        args({ resume: SID, maxTurns: 1, env: { CLINE_API_KEY: 'k' } }),
      ),
    );
    expect(child.written.map((l) => JSON.parse(l).method)).toContain('session/cancel');
    expect(msgs.at(-1)).toMatchObject({ type: 'result', subtype: 'error_max_turns' });
  });
});

it('cleans up the per-turn prompt file', async () => {
  vi.mocked(cp.spawn).mockReturnValueOnce(jsonChild(SUCCESS));
  await collect(new ClineAgentRunner('cline', fakeHost()).run(args()));
  await new Promise((r) => setTimeout(r, 20));
  const argv = spawned()[0][1] as string[];
  expect(existsSync(argv[3])).toBe(false);
});

describe('#389 cline: full access + stdio caller tools', () => {
  /** The live json turn with its final reply swapped for `text`. */
  const replying = (text: string) =>
    SUCCESS.map((l) => {
      const o = JSON.parse(l);
      if (o.event?.contentType === 'text' || o.event?.type === 'done') o.event.text = text;
      if (o.type === 'run_result') o.text = text;
      return JSON.stringify(o);
    });

  /** Round one: a fresh json turn replying `text` (its FIFO prompt kept);
   *  round two: the caller's answer resumes the session over ACP. The
   *  history rows move to the turn's own (mkdtemp) cwd once it is known. */
  function rounds(text: string) {
    const acp = acpChild(ACP);
    const rows = [successRow('x'), successRow('x'), successRow('y')];
    let firstPrompt = '';
    vi.mocked(cp.spawn)
      .mockImplementationOnce(((_c: string, argv: string[]) => {
        firstPrompt = readFileSync(argv[3], 'utf8');
        for (const row of rows) row.cwd = argv[argv.lastIndexOf('-c') + 1];
        return jsonChild(replying(text));
      }) as any)
      .mockReturnValueOnce(acp);
    const host = fakeHost({ histories: rows.map((row) => [row]) });
    const resumedPrompt = () =>
      acp.written.map((l) => JSON.parse(l)).find((m) => m.method === 'session/prompt')?.params
        .prompt[0].text as string;
    return { runner: new ClineAgentRunner('cline', host), firstPrompt: () => firstPrompt, resumedPrompt };
  }

  beforeEach(() => vi.stubEnv('CLINE_API_KEY', PLACEHOLDER));
  afterEach(() => vi.unstubAllEnvs());

  it('a full-access turn calls a stdio tool and gets the result back', async () => {
    const r = rounds(`Checking.\n${callerFence('core')}`);
    const turn = await runFullAccessToolTurn('cline', r.runner);
    expectCallerRoundTrip(turn, ['core']);
    expect(spawned().map((c) => c[0])).toEqual(['/bin/sh', 'cline']);
    // Full access: auto-approve on the user's own config, in its own process group.
    const [, argv, opts] = spawned()[0];
    expect(argv).toEqual(expect.arrayContaining(['--act', '--auto-approve', 'true']));
    expect(argv).not.toContain('--config');
    expect((opts as cp.SpawnOptions).detached).toBe(process.platform !== 'win32');
    // Tool protocol in the first prompt, the caller's answer in the resumed one.
    expect(r.firstPrompt()).toContain('org_roster');
    expect(r.resumedPrompt()).toContain(rosterResult('core'));
  });

  it('two parallel caller calls: both tool_call frames before either tool_result', async () => {
    const r = rounds(`Checking both.\n${callerFence('core')}\n${callerFence('qa')}`);
    const turn = await runFullAccessToolTurn('cline', r.runner, { expectCalls: 2 });
    expectCallerRoundTrip(turn, ['core', 'qa']);
    expectAllCallsBeforeResults(turn, 2);
    expect(r.resumedPrompt()).toContain(rosterResult('core'));
    expect(r.resumedPrompt()).toContain(rosterResult('qa'));
  });
});
