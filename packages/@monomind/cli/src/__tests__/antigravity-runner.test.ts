/**
 * Unit tests for AntigravityAgentRunner.
 *
 * Tests the agy CLI subprocess protocol parsing without requiring the actual
 * agy binary — mocks child_process.spawn and feeds it scripted NDJSON events
 * matching agy 0.35.0's real wire format (verified against a live `agy -p`
 * invocation, not the headless docs page — see antigravity-runner.ts header
 * comment for the discrepancy this caught).
 *
 * Each line is { "event": "init" | "step_update" | "result", ... } with the
 * actual payload nested under a key matching the event name — EXCEPT init's
 * conversation_id, which is a sibling of "event"/"init", not nested inside
 * "init". A prior version of this file (and the runner) assumed a flat
 * `{ type: 'step_update', step_type: ..., text_delta: ... }` shape, which
 * silently matched nothing against the real CLI and dropped all output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AntigravityAgentRunner } from '../orgrt/antigravity-runner.js';
import { EventEmitter } from 'node:events';
import * as cp from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

/** Create a mock child process that emits the given NDJSON lines on stdout. */
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

describe('AntigravityAgentRunner', () => {
  let runner: AntigravityAgentRunner;

  beforeEach(() => {
    runner = new AntigravityAgentRunner('/usr/local/bin/agy');
    vi.clearAllMocks();
  });

  it('builds correct argv: agy -p <prompt> --output-format stream-json', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ event: 'init', conversation_id: 'c1', init: { model: 'gemini-3.6-flash-high' } }),
      JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 5 } } }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: 'You are a test agent',
      model: 'gemini-3.6-flash-high',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    for await (const _m of gen) { /* consume */ }

    const spawnArgs = vi.mocked(cp.spawn).mock.calls[0];
    expect(spawnArgs[0]).toBe('/usr/local/bin/agy');
    expect(spawnArgs[1]).toContain('-p');
    expect(spawnArgs[1]).toContain('--output-format');
    expect(spawnArgs[1]).toContain('stream-json');
    expect(spawnArgs[1]).toContain('--model');
    expect(spawnArgs[1]).toContain('gemini-3.6-flash-high');
    expect(spawnArgs[1]).toContain('--dangerously-skip-permissions');
  });

  it('captures conversation_id from init event', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ event: 'init', conversation_id: 'test-conv-123', init: {} }),
      JSON.stringify({ event: 'result', result: { conversation_id: 'test-conv-123', status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 5 } } }),
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
    expect(resultMsg.session_id).toBe('test-conv-123');
  });

  it('accumulates agent_response text_delta into one message', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
      JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c1', step_type: 'agent_response', state: 'ACTIVE', text_delta: 'Hello' } }),
      JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c1', step_type: 'agent_response', state: 'ACTIVE', text_delta: ' world' } }),
      JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c1', step_type: 'agent_response', state: 'DONE' } }),
      JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 5 } } }),
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

    // agy streams per-token but the runner accumulates and emits one clean
    // message per turn (matching kimi/codex behavior — fence stripping needs
    // the full text, and per-token deltas would split fences across events).
    const assistantMsgs = messages.filter(m => m.type === 'assistant');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].text).toBe('Hello world');
  });

  it('extracts usage from result event', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
      JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', usage: { input_tokens: 1500, output_tokens: 320, thinking_tokens: 50, cache_read_tokens: 200, total_tokens: 2070 } } }),
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
    expect(resultMsg.input_tokens).toBe(1500);
    expect(resultMsg.output_tokens).toBe(320);
  });

  it('surfaces error from non-SUCCESS result status', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
      JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status: 'ERROR', error: 'model not found' } }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow('model not found');
  });

  it('uses --conversation flag when conversationId provided', async () => {
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ event: 'init', conversation_id: 'existing-conv', init: {} }),
      JSON.stringify({ event: 'result', result: { conversation_id: 'existing-conv', status: 'SUCCESS', usage: { input_tokens: 0, output_tokens: 0 } } }),
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'follow up'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
      resume: 'existing-conv',
    });

    for await (const _m of gen) { /* consume */ }

    const spawnArgs = vi.mocked(cp.spawn).mock.calls[0];
    expect(spawnArgs[1]).toContain('--conversation');
    expect(spawnArgs[1]).toContain('existing-conv');
  });

  it('throws ENOENT error with install guidance when agy binary missing', async () => {
    vi.mocked(cp.spawn).mockImplementation(() => {
      const err = new Error('spawn agy ENOENT') as any;
      err.code = 'ENOENT';
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stdout[Symbol.asyncIterator] = async function* () { /* empty */ };
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      setTimeout(() => child.emit('error', err), 1);
      return child;
    });

    const runner = new AntigravityAgentRunner('agy');
    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'hello'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow('requires the Antigravity CLI');
  });

  it('falls back to result.response when no text_delta streamed', async () => {
    // Some agy versions may not stream text_delta and only return final response.
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
      JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: 'Final response text', usage: { input_tokens: 10, output_tokens: 5 } } }),
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
    expect(assistantMsg.text).toBe('Final response text');
  });

  it('strips tool_call fences from streamed text (no tools registered → error result → clean second turn)', async () => {
    vi.mocked(cp.spawn)
      .mockReturnValueOnce(makeMockChild([
        JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
        JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c1', step_type: 'agent_response', state: 'ACTIVE', text_delta: 'Sending...\n\n```tool_call\n{"name": "org_send", "arguments": {"to": "boss"}}\n```' } }),
        JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 5 } } }),
      ]))
      .mockReturnValueOnce(makeMockChild([
        JSON.stringify({ event: 'init', conversation_id: 'c1', init: {} }),
        JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c1', step_type: 'agent_response', state: 'ACTIVE', text_delta: 'Done.' } }),
        JSON.stringify({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', usage: { input_tokens: 10, output_tokens: 5 } } }),
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

    // First assistant message should not contain tool_call fences
    const firstAssistant = messages.find(m => m.type === 'assistant' && m.text === 'Sending...');
    expect(firstAssistant).toBeDefined();
    expect(firstAssistant.text).not.toContain('tool_call');

    const doneMsg = messages.find(m => m.type === 'assistant' && m.text === 'Done.');
    expect(doneMsg).toBeDefined();
  }, 15000);

  it('matches the exact live agy 0.35.0 NDJSON shape (regression guard)', async () => {
    // Captured verbatim from `agy -p "reply with exactly: PING_OK" --model
    // gemini-3.6-flash-high --output-format stream-json
    // --dangerously-skip-permissions` — pins the wire format so a future
    // agy update that reshapes events fails this test loudly instead of
    // silently dropping all output like the original bug did.
    vi.mocked(cp.spawn).mockReturnValue(makeMockChild([
      '{"event":"init","conversation_id":"12e01fe5-877a-4aa3-9572-93a6d0b4b1d9","init":{"model":"gemini-3.6-flash-high","cwd":"/tmp","tools":["finish"],"permission_mode":"always-proceed"}}',
      '{"event":"step_update","step_update":{"conversation_id":"12e01fe5-877a-4aa3-9572-93a6d0b4b1d9","step_index":0,"state":"DONE","step_type":"user_input"}}',
      '{"event":"step_update","step_update":{"conversation_id":"12e01fe5-877a-4aa3-9572-93a6d0b4b1d9","step_index":2,"state":"DONE","step_type":"agent_response","text_delta":"PING_OK\\n","duration_seconds":1.017427,"usage":{"input_tokens":8032,"output_tokens":31,"thinking_tokens":28,"cache_read_tokens":8141,"total_tokens":8063}}}',
      '{"event":"result","result":{"conversation_id":"12e01fe5-877a-4aa3-9572-93a6d0b4b1d9","status":"SUCCESS","response":"PING_OK\\n","duration_seconds":1.714006,"num_turns":1,"usage":{"input_tokens":8132,"output_tokens":35,"thinking_tokens":28,"cache_read_tokens":8141,"total_tokens":8167}}}',
    ]));

    const gen = runner.run({
      tools: [],
      prompt: (async function* () { yield 'reply with exactly: PING_OK'; })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    });

    const messages: any[] = [];
    for await (const m of gen) messages.push(m);

    const assistantMsg = messages.find(m => m.type === 'assistant');
    expect(assistantMsg?.text).toBe('PING_OK');
    const resultMsg = messages.find(m => m.type === 'result');
    expect(resultMsg.input_tokens).toBe(8132);
    expect(resultMsg.output_tokens).toBe(35);
  });
});
