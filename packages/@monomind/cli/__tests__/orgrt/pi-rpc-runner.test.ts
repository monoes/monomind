/**
 * Unit tests for pi-rpc-runner.ts: the pure JSONL codec/extraction helpers,
 * and the full turn-completion state machine driven against a fake
 * PiRpcProcess (no real `pi` binary needed — see the runner's file header
 * for why this orchestration logic specifically gets integration-style
 * coverage, not just the pure helpers).
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  JsonlDecoder,
  encodePiRpcCommand,
  extractPiRpcText,
  PiRpcAgentRunner,
  type PiRpcProcess,
} from '../../src/orgrt/pi-rpc-runner.js';
import type { AgentRunArgs, AgentMessage } from '../../src/orgrt/agent-runner.js';

describe('JsonlDecoder', () => {
  it('decodes a single complete line', () => {
    const d = new JsonlDecoder();
    expect(d.feed('{"type":"agent_start"}\n')).toEqual([{ type: 'agent_start' }]);
  });

  it('reassembles a line split across feed() calls', () => {
    const d = new JsonlDecoder();
    expect(d.feed('{"type":"age')).toEqual([]);
    expect(d.feed('nt_start"}\n')).toEqual([{ type: 'agent_start' }]);
  });

  it('decodes multiple lines from one chunk', () => {
    const d = new JsonlDecoder();
    const out = d.feed('{"type":"a"}\n{"type":"b"}\n');
    expect(out).toEqual([{ type: 'a' }, { type: 'b' }]);
  });

  it('skips a malformed line without throwing or losing the next one', () => {
    const d = new JsonlDecoder();
    const out = d.feed('not json\n{"type":"ok"}\n');
    expect(out).toEqual([{ type: 'ok' }]);
  });
});

describe('encodePiRpcCommand', () => {
  it('produces an LF-terminated JSON line with the documented "type" key', () => {
    expect(encodePiRpcCommand({ type: 'prompt', message: 'hi' })).toBe('{"type":"prompt","message":"hi"}\n');
  });

  it('omits undefined fields', () => {
    expect(encodePiRpcCommand({ type: 'get_state' })).toBe('{"type":"get_state"}\n');
  });
});

describe('extractPiRpcText', () => {
  it('joins text blocks and drops thinking/toolCall blocks', () => {
    const text = extractPiRpcText({
      content: [
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: 'hello' },
        { type: 'toolCall', id: 'c1', name: 'bash', arguments: {} },
        { type: 'text', text: 'world' },
      ],
    });
    expect(text).toBe('hello\nworld');
  });

  it('returns empty string for a content-free message', () => {
    expect(extractPiRpcText({})).toBe('');
  });
});

/** A minimal fake PiRpcProcess: an EventEmitter-backed duplex that records
 *  every command written to stdin and lets the test script server-side
 *  events onto stdout on its own schedule. */
function fakeProcess(): PiRpcProcess & { written: string[]; emitStdout: (line: string) => void; emitClose: (code: number) => void; emitError: (err: Error) => void } {
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

describe('PiRpcAgentRunner — turn-completion state machine', () => {
  it('sends one prompt command and yields assistant text once isStreaming settles to false', async () => {
    const proc = fakeProcess();
    const runner = new PiRpcAgentRunner('pi', () => proc);

    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));

    // Let the runner send its first prompt, then drive the fake server side.
    await new Promise((r) => setTimeout(r, 10));
    expect(proc.written[0]).toContain('"type":"prompt"');

    proc.emitStdout('{"type":"agent_start"}\n');
    proc.emitStdout('{"type":"message_end","message":{"content":[{"type":"text","text":"Hi there"}]}}\n');
    await new Promise((r) => setTimeout(r, 10));
    // The runner should have asked get_state after message_end.
    expect(proc.written.some((w) => w.includes('"type":"get_state"'))).toBe(true);

    proc.emitStdout('{"type":"response","command":"get_state","success":true,"data":{"isStreaming":false}}\n');
    proc.emitClose(0);

    const messages = await resultsPromise;
    const assistant = messages.filter((m) => m.type === 'assistant');
    expect(assistant.map((m) => m.text)).toEqual(['Hi there']);
    const result = messages.find((m) => m.type === 'result');
    expect(result).toBeDefined();
  });

  it('keeps waiting through multiple message_end cycles while pi is still streaming', async () => {
    const proc = fakeProcess();
    const runner = new PiRpcAgentRunner('pi', () => proc);
    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));
    await new Promise((r) => setTimeout(r, 10));

    // First internal cycle: pi is still working (its own native tool use).
    proc.emitStdout('{"type":"message_end","message":{"content":[{"type":"text","text":"working on it"}]}}\n');
    await new Promise((r) => setTimeout(r, 10));
    proc.emitStdout('{"type":"response","command":"get_state","success":true,"data":{"isStreaming":true}}\n');
    await new Promise((r) => setTimeout(r, 10));

    // Second cycle: now it's actually done.
    proc.emitStdout('{"type":"message_end","message":{"content":[{"type":"text","text":"done now"}]}}\n');
    await new Promise((r) => setTimeout(r, 10));
    proc.emitStdout('{"type":"response","command":"get_state","success":true,"data":{"isStreaming":false}}\n');
    proc.emitClose(0);

    const messages = await resultsPromise;
    // Text from both internal cycles is consolidated into one assistant
    // message once the turn actually settles (isStreaming:false) — not one
    // yield per message_end, since intermediate cycles aren't "done" yet.
    const assistant = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(assistant).toEqual(['working on it\ndone now']);
  });

  it('extracts an org tool_call fence, executes it, and continues the same session', async () => {
    const proc = fakeProcess();
    const executeCalls: string[] = [];
    const runner = new PiRpcAgentRunner('pi', () => proc);

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
    proc.emitStdout(JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: `Sending now.\n${fence}` }] } }) + '\n');
    await new Promise((r) => setTimeout(r, 10));
    proc.emitStdout('{"type":"response","command":"get_state","success":true,"data":{"isStreaming":false}}\n');
    await new Promise((r) => setTimeout(r, 10));

    // The runner should have sent a follow-up prompt with the tool result —
    // not a fresh system-prompt-carrying message.
    const secondPrompt = proc.written.find((w, i) => i > 0 && w.includes('"type":"prompt"'));
    expect(secondPrompt).toBeDefined();
    expect(secondPrompt).not.toContain('You are a test agent'); // no system prompt re-sent

    proc.emitStdout('{"type":"message_end","message":{"content":[{"type":"text","text":"Done."}]}}\n');
    await new Promise((r) => setTimeout(r, 10));
    proc.emitStdout('{"type":"response","command":"get_state","success":true,"data":{"isStreaming":false}}\n');
    proc.emitClose(0);

    const messages = await resultsPromise;
    expect(executeCalls).toHaveLength(1);
    expect(messages.some((m) => m.type === 'assistant' && m.text === 'Sending now.')).toBe(true);
    expect(messages.some((m) => m.type === 'assistant' && m.text === 'Done.')).toBe(true);
  });

  it('the first prompt carries the system prompt + tool protocol', async () => {
    const proc = fakeProcess();
    const runner = new PiRpcAgentRunner('pi', () => proc);
    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));
    await new Promise((r) => setTimeout(r, 10));

    expect(proc.written[0]).toContain('You are a test agent');

    proc.emitStdout('{"type":"message_end","message":{"content":[{"type":"text","text":"ok"}]}}\n');
    await new Promise((r) => setTimeout(r, 10));
    proc.emitStdout('{"type":"response","command":"get_state","success":true,"data":{"isStreaming":false}}\n');
    proc.emitClose(0);
    await resultsPromise;
  });

  it('surfaces a clear error and never hangs when the process closes unexpectedly', async () => {
    const proc = fakeProcess();
    const runner = new PiRpcAgentRunner('pi', () => proc);
    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));
    await new Promise((r) => setTimeout(r, 10));

    proc.emitClose(1);

    await expect(resultsPromise).rejects.toThrow(/pi rpc process ended unexpectedly/);
  });

  it('surfaces the ORIGINAL spawn error (with its .code intact) instead of a generic wrapper — regression: an earlier revision discarded the real error, so ENOENT (missing pi binary) never matched the install-instructions branch', async () => {
    const proc = fakeProcess();
    const runner = new PiRpcAgentRunner('pi', () => proc);
    const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));
    await new Promise((r) => setTimeout(r, 10));

    const enoent = Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' });
    proc.emitError(enoent);

    await expect(resultsPromise).rejects.toThrow(/requires the Pi coding agent CLI \(pi\) on PATH/);
  });

  it('does not let the silence watchdog kill a healthy session while a tool call (e.g. ask_human) blocks for longer than the silence window — regression: an earlier revision only bumped the silence clock AFTER the tool call resolved, leaving the watchdog free to fire while it was still pending', async () => {
    vi.useFakeTimers();
    try {
      const proc = fakeProcess();
      const runner = new PiRpcAgentRunner('pi', () => proc);

      let releaseTool: () => void = () => {};
      const toolBlocked = new Promise<void>((resolve) => { releaseTool = resolve; });
      const args = baseArgs(singlePrompt('hello'));
      args.tools = [{
        name: 'ask_human',
        description: 'ask a human',
        schema: {},
        handler: async () => { await toolBlocked; return { text: 'answered' }; },
      }];

      const resultsPromise = collect(runner.run(args));
      await vi.advanceTimersByTimeAsync(10);

      const fence = '```tool_call\n{"name":"ask_human","arguments":{}}\n```';
      proc.emitStdout(JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: `Asking.\n${fence}` }] } }) + '\n');
      await vi.advanceTimersByTimeAsync(10);
      proc.emitStdout('{"type":"response","command":"get_state","success":true,"data":{"isStreaming":false}}\n');
      await vi.advanceTimersByTimeAsync(10);

      // The tool call is now blocked ("waiting on a human"). Advance well
      // past the 10-minute silence window while it's still pending.
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
      expect(proc.kill).not.toHaveBeenCalled();

      // Let the human "answer" and finish the turn normally.
      releaseTool();
      await vi.advanceTimersByTimeAsync(10);
      proc.emitStdout(JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'Done.' }] } }) + '\n');
      await vi.advanceTimersByTimeAsync(10);
      proc.emitStdout('{"type":"response","command":"get_state","success":true,"data":{"isStreaming":false}}\n');
      proc.emitClose(0);
      await vi.advanceTimersByTimeAsync(10);

      const messages = await resultsPromise;
      expect(messages.some((m) => m.type === 'assistant' && m.text === 'Done.')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a genuinely wedged session (no tool call pending, no output at all) still eventually gets killed — sanity check that the watchdogs are not neutered by the toolCallInFlight pause added above', async () => {
    vi.useFakeTimers();
    try {
      const proc = fakeProcess();
      const runner = new PiRpcAgentRunner('pi', () => proc);
      const resultsPromise = collect(runner.run(baseArgs(singlePrompt('hello'))));

      // Total silence from the very first moment — whichever watchdog
      // catches it first (the one-shot startup timer or the rolling
      // mid-session one; which one wins the race isn't the point of this
      // test, only that SOME kill path fires and toolCallInFlight — which
      // defaults to false and is never set here — doesn't block it).
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

      await expect(resultsPromise).rejects.toThrow(/produced no output|process ended unexpectedly/);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });
});
