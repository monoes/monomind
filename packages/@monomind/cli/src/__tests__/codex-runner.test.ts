/**
 * Unit tests for CodexAgentRunner.
 *
 * Tests the Codex CLI subprocess protocol parsing without requiring the actual
 * codex binary — mocks child_process.spawn and feeds it scripted JSONL events.
 *
 * Two wire formats are exercised:
 *   - LEGACY (the original "session_configured"/"agent_message"/"token_count"/
 *     "task_complete" v1 EventMsg shape), confirmed live against codex
 *     v0.21.0/v0.147.0 (#178).
 *   - CURRENT (the "thread.started"/"turn.started"/"item.completed"/
 *     "turn.completed" item-based shape), confirmed live against codex
 *     v0.149.0 (#178 follow-up, #204) — three real `codex exec --json`
 *     invocations with the ChatGPT-subscription login: a plain text turn, a
 *     turn with a command_execution tool call, and 3 resumed turns checking
 *     turn.completed.usage stays roughly flat per-turn rather than growing
 *     cumulatively. The legacy shape was NOT observed at all from a live
 *     v0.149.0 install — this is what actually reaches monomind's users
 *     today, so the runner must parse it or every codex-backed org role
 *     silently produces zero assistant text and zero token accounting.
 *   Both are kept: the header's Rust-source citation for the legacy shape
 *   being "still the live default for --json" as of v0.147.0 may still hold
 *   for older installs, and there's no live-verified evidence it was ever
 *   wrong for that version — only that 0.149.0 has since moved on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAgentRunner } from '../orgrt/codex-runner.js';
import { EventEmitter } from 'node:events';
import * as cp from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

/** Create a mock child process that emits the given JSONL lines on stdout. */
function makeMockChild(stdoutLines: string[], exitCode = 0): cp.ChildProcess {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stdout[Symbol.asyncIterator] = async function* () {
    for (const line of stdoutLines) {
      yield Buffer.from(line + '\n');
    }
  };
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setTimeout(() => child.emit('close', exitCode), 5);
  return child as cp.ChildProcess;
}

/** token_count event helper — last_token_usage is per-turn (see file header:
 *  the runner reads THIS field, not total_token_usage, which is cumulative). */
const TOKEN_COUNT = {
  type: 'token_count',
  info: { last_token_usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 15 } },
};

describe('CodexAgentRunner', () => {
  let runner: CodexAgentRunner;

  beforeEach(() => {
    runner = new CodexAgentRunner('/usr/bin/codex');
    vi.clearAllMocks();
  });

  it('builds correct argv: codex exec --json', async () => {
    const mockChild = makeMockChild([
      JSON.stringify({ type: 'session_configured', session_id: 't1', thread_id: 't1' }),
      JSON.stringify({ type: 'task_started' }),
      JSON.stringify(TOKEN_COUNT),
    ]);
    vi.mocked(cp.spawn).mockReturnValue(mockChild);

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: 'You are a test agent',
      model: 'gpt-5.6-terra',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    for await (const _m of gen) { /* consume */ }

    const spawnArgs = vi.mocked(cp.spawn).mock.calls[0];
    expect(spawnArgs[0]).toBe('/usr/bin/codex');
    expect(spawnArgs[1]).toContain('exec');
    expect(spawnArgs[1]).toContain('--json');
    expect(spawnArgs[1]).not.toContain('--experimental-json');
    expect(spawnArgs[1]).toContain('--model');
    expect(spawnArgs[1]).toContain('gpt-5.6-terra');
    expect(spawnArgs[1]).toContain('--sandbox');
    expect(spawnArgs[1]).toContain('danger-full-access');
    expect(spawnArgs[1]).toContain('--skip-git-repo-check');
  });

  it('captures session id from session_configured event', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'session_configured', session_id: 'test-thread-123', thread_id: 'test-thread-123' }),
      JSON.stringify(TOKEN_COUNT),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const resultMsg = messages.find(m => m.type === 'result');
    expect(resultMsg.session_id).toBe('test-thread-123');
  });

  it('extracts text from agent_message events', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'session_configured', session_id: 't1', thread_id: 't1' }),
      JSON.stringify({ type: 'agent_message', message: 'Hello world!' }),
      JSON.stringify(TOKEN_COUNT),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const assistantMsg = messages.find(m => m.type === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.text).toBe('Hello world!');
  });

  it('extracts per-turn usage from token_count.info.last_token_usage (not the cumulative total_token_usage)', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'session_configured', session_id: 't1', thread_id: 't1' }),
      JSON.stringify({
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 24763, output_tokens: 122, cached_input_tokens: 24448, cache_write_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 24885 },
          total_token_usage: { input_tokens: 999999, output_tokens: 999999, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1999998 },
        },
      }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const resultMsg = messages.find(m => m.type === 'result');
    expect(resultMsg.input_tokens).toBe(24763);
    expect(resultMsg.output_tokens).toBe(122);
  });

  it('surfaces error from task_complete.error', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'session_configured', session_id: 't1', thread_id: 't1' }),
      JSON.stringify({ type: 'task_complete', turn_id: 'turn1', last_agent_message: null, error: { message: 'rate limited' } }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow('rate limited');
  });

  it('uses resume positional arg when threadId provided', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'session_configured', session_id: 'existing-thread', thread_id: 'existing-thread' }),
      JSON.stringify(TOKEN_COUNT),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'follow up'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
      resume: 'existing-thread',
    });

    for await (const _m of gen) { /* consume */ }

    const spawnArgs = vi.mocked(cp.spawn).mock.calls[0];
    expect(spawnArgs[1]).toContain('resume');
    expect(spawnArgs[1]).toContain('existing-thread');
  });

  it('throws ENOENT error with install guidance when codex binary missing', async () => {
    vi.mocked(cp.spawn).mockImplementation(() => {
      const err = new Error('spawn codex ENOENT') as any;
      err.code = 'ENOENT';
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stdout[Symbol.asyncIterator] = async function* () { /* empty */ };
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      setTimeout(() => child.emit('error', err), 1);
      return child;
    });

    const runner = new CodexAgentRunner('codex');
    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow('requires the Codex CLI');
  });

  it('strips tool_call fences from bus-visible text (no tools registered → error result → clean second turn)', async () => {
    // First turn: assistant emits text with a tool_call fence. Since no tools
    // are registered, executeToolCall returns an error string. The runner
    // feeds that error back as the next prompt. Second turn: clean response
    // with no tool calls → loop ends.
    vi.mocked(cp.spawn)
      .mockReturnValueOnce(makeMockChild([
        JSON.stringify({ type: 'session_configured', session_id: 't1', thread_id: 't1' }),
        JSON.stringify({ type: 'agent_message', message: 'Sending...\n\n```tool_call\n{"name": "org_send", "arguments": {"to": "boss"}}\n```' }),
        JSON.stringify(TOKEN_COUNT),
      ]))
      .mockReturnValueOnce(makeMockChild([
        JSON.stringify({ type: 'session_configured', session_id: 't1', thread_id: 't1' }),
        JSON.stringify({ type: 'agent_message', message: 'Done.' }),
        JSON.stringify(TOKEN_COUNT),
      ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    // First assistant message should have fences stripped
    const firstAssistant = messages.find(m => m.type === 'assistant' && m.text === 'Sending...');
    expect(firstAssistant).toBeDefined();
    expect(firstAssistant.text).not.toContain('tool_call');

    // Second turn's assistant message
    const doneMsg = messages.find(m => m.type === 'assistant' && m.text === 'Done.');
    expect(doneMsg).toBeDefined();
  }, 15000);
});

describe('CodexAgentRunner — CURRENT item-based wire format (live-verified against codex v0.149.0, #204)', () => {
  let runner: CodexAgentRunner;

  beforeEach(() => {
    runner = new CodexAgentRunner('/usr/bin/codex');
    vi.clearAllMocks();
  });

  it('captures thread id from a real thread.started event', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: '01a02a2f-43cf-7382-91db-8817db3ba376' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'pong' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 13085, cached_input_tokens: 9984, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'reply with exactly the word: pong'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const resultMsg = messages.find(m => m.type === 'result');
    expect(resultMsg.session_id).toBe('01a02a2f-43cf-7382-91db-8817db3ba376');
  });

  it('extracts text from an item.completed agent_message item', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'pong' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 13085, output_tokens: 5 } }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const assistantMsg = messages.find(m => m.type === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.text).toBe('pong');
  });

  it('ignores item.started/item.completed command_execution items but still surfaces the agent_message items around them', async () => {
    // Real captured sequence from `codex exec --json ... "run: echo hello-from-codex-shell"`.
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'I’ll run that shell command now.' } }),
      JSON.stringify({ type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'echo hello-from-codex-shell'", aggregated_output: '', exit_code: null, status: 'in_progress' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'echo hello-from-codex-shell'", aggregated_output: 'hello-from-codex-shell\n', exit_code: 0, status: 'completed' } }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: '```text\nhello-from-codex-shell\n```' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 26343, output_tokens: 154, reasoning_output_tokens: 14 } }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'run: echo hello-from-codex-shell'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    // Exactly the two agent_message items, in order — the command_execution
    // item.started/item.completed pair in between must not synthesize a
    // third assistant message from its own command/aggregated_output fields.
    const assistantTexts = messages.filter(m => m.type === 'assistant').map(m => m.text);
    expect(assistantTexts).toEqual(['I’ll run that shell command now.', '```text\nhello-from-codex-shell\n```']);
  });

  it('extracts per-turn usage from turn.completed.usage', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'hi' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 13112, cached_input_tokens: 12032, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const resultMsg = messages.find(m => m.type === 'result');
    expect(resultMsg.input_tokens).toBe(13112);
    expect(resultMsg.output_tokens).toBe(5);
  });

  it('uses resume positional arg when threadId provided, unchanged by the wire-format fix', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: 'existing-thread' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'ok' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'follow up'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
      resume: 'existing-thread',
    });

    for await (const _m of gen) { /* consume */ }

    const spawnArgs = vi.mocked(cp.spawn).mock.calls[0];
    expect(spawnArgs[1]).toContain('resume');
    expect(spawnArgs[1]).toContain('existing-thread');
  });
});
