/**
 * Unit tests for CodexAgentRunner.
 *
 * Tests the Codex CLI subprocess protocol parsing without requiring the actual
 * codex binary — mocks child_process.spawn and feeds it scripted JSONL events
 * matching the byte-accurate schema from openai/codex/sdk/typescript/src.
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

/** Usage event helper */
const USAGE = { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0 };

describe('CodexAgentRunner', () => {
  let runner: CodexAgentRunner;

  beforeEach(() => {
    runner = new CodexAgentRunner('/usr/bin/codex');
    vi.clearAllMocks();
  });

  it('builds correct argv: codex exec --experimental-json', async () => {
    const mockChild = makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'turn.completed', usage: USAGE }),
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
    expect(spawnArgs[1]).toContain('--experimental-json');
    expect(spawnArgs[1]).toContain('--model');
    expect(spawnArgs[1]).toContain('gpt-5.6-terra');
    expect(spawnArgs[1]).toContain('--sandbox');
    expect(spawnArgs[1]).toContain('danger-full-access');
    expect(spawnArgs[1]).toContain('--skip-git-repo-check');
  });

  it('captures thread_id from thread.started event', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: 'test-thread-123' }),
      JSON.stringify({ type: 'turn.completed', usage: USAGE }),
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

  it('extracts agent_message text from item.completed', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Hello world!' } }),
      JSON.stringify({ type: 'turn.completed', usage: USAGE }),
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

  it('extracts usage from turn.completed', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 24763, output_tokens: 122, cached_input_tokens: 24448, cache_write_input_tokens: 0, reasoning_output_tokens: 0 } }),
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

  it('surfaces error from turn.failed event', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'turn.failed', error: { message: 'rate limited' } }),
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
      JSON.stringify({ type: 'thread.started', thread_id: 'existing-thread' }),
      JSON.stringify({ type: 'turn.completed', usage: USAGE }),
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
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Sending...\n\n```tool_call\n{"name": "org_send", "arguments": {"to": "boss"}}\n```' } }),
        JSON.stringify({ type: 'turn.completed', usage: USAGE }),
      ]))
      .mockReturnValueOnce(makeMockChild([
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Done.' } }),
        JSON.stringify({ type: 'turn.completed', usage: USAGE }),
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
