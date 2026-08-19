/**
 * Unit tests for qwen-rpc-runner.ts: the pure JSONL codec/extraction
 * helpers, and the full turn-completion state machine driven against a
 * fake QwenRpcProcess (no real `qwen` binary needed).
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  QwenJsonlDecoder,
  encodeQwenRpcUserMessage,
  extractQwenRpcText,
  QwenRpcAgentRunner,
  type QwenRpcProcess,
} from '../../src/orgrt/qwen-rpc-runner.js';
import type { AgentRunArgs, AgentMessage } from '../../src/orgrt/agent-runner.js';

describe('QwenJsonlDecoder', () => {
  it('decodes a single complete line', () => {
    const d = new QwenJsonlDecoder();
    expect(d.feed('{"type":"system"}\n')).toEqual([{ type: 'system' }]);
  });

  it('reassembles a line split across feed() calls', () => {
    const d = new QwenJsonlDecoder();
    expect(d.feed('{"type":"sys')).toEqual([]);
    expect(d.feed('tem"}\n')).toEqual([{ type: 'system' }]);
  });

  it('skips a malformed line without throwing or losing the next one', () => {
    const d = new QwenJsonlDecoder();
    const out = d.feed('not json\n{"type":"ok"}\n');
    expect(out).toEqual([{ type: 'ok' }]);
  });
});

describe('encodeQwenRpcUserMessage', () => {
  it('produces the documented {"type":"user","message":{"content":"..."}} shape', () => {
    expect(encodeQwenRpcUserMessage('hi')).toBe('{"type":"user","message":{"content":"hi"}}\n');
  });
});

describe('extractQwenRpcText', () => {
  it('joins text blocks and drops thinking blocks', () => {
    const text = extractQwenRpcText({
      content: [
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    });
    expect(text).toBe('hello\nworld');
  });

  it('returns empty string for a content-free message', () => {
    expect(extractQwenRpcText({})).toBe('');
  });
});

/** A minimal fake QwenRpcProcess: an EventEmitter-backed duplex that
 *  records every command written to stdin and lets the test script
 *  server-side events onto stdout on its own schedule. */
function fakeProcess(): QwenRpcProcess & { written: string[]; emitStdout: (line: string) => void; emitClose: (code: number) => void; emitError: (err: Error) => void } {
  const emitter = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  const written: string[] = [];
  return {
    stdin: { write: (data: string) => { written.push(data); } },
    stdout: { on: (event, cb) => { stdoutEmitter.on(event, cb); } },
    stderr: { on: () => {} },
    on: (event: string, cb: (...a: unknown[]) => void) => { emitter.on(event, cb); },
    kill: vi.fn(),
    written,
    emitStdout: (line: string) => stdoutEmitter.emit('data', Buffer.from(line)),
    emitClose: (code: number) => emitter.emit('close', code),
    emitError: (err: Error) => emitter.emit('error', err),
  };
}

function baseArgs(prompt: AsyncIterable<string>): AgentRunArgs {
  return {
    tools: [],
    prompt,
    systemPrompt: 'You are a test agent.',
    cwd: '/tmp/test-project',
    env: {},
    maxTurns: 10,
  };
}

async function* singlePrompt(text: string): AsyncGenerator<string> {
  yield text;
}

async function collect(iter: AsyncIterable<AgentMessage>): Promise<AgentMessage[]> {
  const out: AgentMessage[] = [];
  for await (const m of iter) out.push(m);
  return out;
}

describe('QwenRpcAgentRunner — turn-completion state machine', () => {
  it('sends one user message and yields assistant text once result arrives', async () => {
    const proc = fakeProcess();
    const runner = new QwenRpcAgentRunner('qwen', () => proc);

    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));

    await new Promise((r) => setTimeout(r, 10));
    expect(proc.written[0]).toBe('{"type":"user","message":{"content":"You are a test agent.\\n\\n---\\n\\nhello"}}\n');

    proc.emitStdout('{"type":"system","subtype":"init","session_id":"s1"}\n');
    proc.emitStdout(JSON.stringify({ type: 'assistant', session_id: 's1', message: { content: [{ type: 'text', text: 'Hi there' }] } }) + '\n');
    proc.emitStdout(JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: { input_tokens: 10, output_tokens: 5 } }) + '\n');
    proc.emitClose(0);

    const messages = await resultsPromise;
    const assistant = messages.filter((m) => m.type === 'assistant');
    expect(assistant.map((m) => m.text)).toEqual(['Hi there']);
    const result = messages.find((m) => m.type === 'result');
    expect(result).toBeDefined();
    expect(result?.session_id).toBe('s1');
    expect(result?.input_tokens).toBe(10);
    expect(result?.output_tokens).toBe(5);
  });

  it('consolidates text from multiple assistant events before a single result (native tool-use cycle)', async () => {
    const proc = fakeProcess();
    const runner = new QwenRpcAgentRunner('qwen', () => proc);
    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));
    await new Promise((r) => setTimeout(r, 10));

    proc.emitStdout(JSON.stringify({ type: 'assistant', session_id: 's1', message: { content: [{ type: 'text', text: 'working on it' }] } }) + '\n');
    proc.emitStdout(JSON.stringify({ type: 'assistant', session_id: 's1', message: { content: [{ type: 'text', text: 'done now' }] } }) + '\n');
    proc.emitStdout(JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
    proc.emitClose(0);

    const messages = await resultsPromise;
    const assistant = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(assistant).toEqual(['working on it\ndone now']);
  });

  it('extracts an org tool_call fence, executes it, and continues the same session', async () => {
    const proc = fakeProcess();
    const executeCalls: string[] = [];
    const runner = new QwenRpcAgentRunner('qwen', () => proc);

    const args = baseArgs(singlePrompt('hello'));
    args.tools = [{
      name: 'org_send',
      description: 'send a message',
      schema: {},
      handler: async (input) => { executeCalls.push(JSON.stringify(input)); return { text: 'sent' }; },
    }];

    const resultsPromise = collect(runner.run(args));
    await new Promise((r) => setTimeout(r, 10));

    const fence = '```tool_call\n{"name":"org_send","arguments":{"to":"boss","subject":"s","message":"m"}}\n```';
    proc.emitStdout(JSON.stringify({ type: 'assistant', session_id: 's1', message: { content: [{ type: 'text', text: `Sending now.\n${fence}` }] } }) + '\n');
    proc.emitStdout(JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
    await new Promise((r) => setTimeout(r, 10));

    const secondMessage = proc.written.find((w, i) => i > 0);
    expect(secondMessage).toBeDefined();
    expect(secondMessage).not.toContain('You are a test agent');

    proc.emitStdout(JSON.stringify({ type: 'assistant', session_id: 's1', message: { content: [{ type: 'text', text: 'Done.' }] } }) + '\n');
    proc.emitStdout(JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
    proc.emitClose(0);

    const messages = await resultsPromise;
    expect(executeCalls).toHaveLength(1);
    expect(messages.some((m) => m.type === 'assistant' && m.text === 'Sending now.')).toBe(true);
    expect(messages.some((m) => m.type === 'assistant' && m.text === 'Done.')).toBe(true);
  });

  it('surfaces a result error as a thrown error', async () => {
    const proc = fakeProcess();
    const runner = new QwenRpcAgentRunner('qwen', () => proc);
    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));
    await new Promise((r) => setTimeout(r, 10));

    proc.emitStdout(JSON.stringify({ type: 'result', subtype: 'error', session_id: 's1', usage: { input_tokens: 0, output_tokens: 0 }, error: { message: 'quota exceeded' } }) + '\n');

    await expect(resultsPromise).rejects.toThrow(/quota exceeded/);
  });

  it('surfaces a clear error and never hangs when the process closes unexpectedly', async () => {
    const proc = fakeProcess();
    const runner = new QwenRpcAgentRunner('qwen', () => proc);
    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));
    await new Promise((r) => setTimeout(r, 10));

    proc.emitClose(1);

    await expect(resultsPromise).rejects.toThrow(/qwen rpc process ended unexpectedly/);
  });

  it('surfaces the ORIGINAL spawn error (with its .code intact) instead of a generic wrapper', async () => {
    const proc = fakeProcess();
    const runner = new QwenRpcAgentRunner('qwen', () => proc);
    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));
    await new Promise((r) => setTimeout(r, 10));

    const enoent = Object.assign(new Error('spawn qwen ENOENT'), { code: 'ENOENT' });
    proc.emitError(enoent);

    await expect(resultsPromise).rejects.toThrow(/requires the Qwen Code CLI \(qwen\) on PATH/);
  });

  it('the first message carries the system prompt + tool protocol; subsequent prompts do not', async () => {
    const proc = fakeProcess();
    const runner = new QwenRpcAgentRunner('qwen', () => proc);

    async function* twoPrompts() {
      yield 'first';
      yield 'second';
    }

    const resultsPromise = collect(runner.run(baseArgs(twoPrompts())));
    await new Promise((r) => setTimeout(r, 10));

    expect(proc.written[0]).toContain('You are a test agent');
    proc.emitStdout(JSON.stringify({ type: 'assistant', session_id: 's1', message: { content: [{ type: 'text', text: 'ok1' }] } }) + '\n');
    proc.emitStdout(JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
    await new Promise((r) => setTimeout(r, 10));

    expect(proc.written[1]).toBe('{"type":"user","message":{"content":"second"}}\n');
    proc.emitStdout(JSON.stringify({ type: 'assistant', session_id: 's1', message: { content: [{ type: 'text', text: 'ok2' }] } }) + '\n');
    proc.emitStdout(JSON.stringify({ type: 'result', subtype: 'success', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
    proc.emitClose(0);

    await resultsPromise;
  });
});
