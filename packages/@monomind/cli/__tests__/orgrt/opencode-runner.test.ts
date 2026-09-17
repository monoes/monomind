/**
 * Unit tests for OpencodeAgentRunner (opencode-runner.ts).
 *
 * Rewritten for the event-stream-driven design: `session.prompt()` (blocking,
 * returns the full response in one shot) is replaced by `session.promptAsync()`
 * (fire-and-forget, 204 No Content) plus `client.event.subscribe()` (a
 * long-lived SSE stream the runner watches for `message.part.delta` — the
 * real per-token event, confirmed live against an actual opencode server;
 * NOT documented in the installed SDK's own .d.ts, which only shows
 * `message.part.updated`'s always-undefined `delta` field — and
 * `message.updated` with `info.time.completed` set as the per-message
 * completion signal).
 *
 * Regression coverage retained from the original blocking-call suite:
 *   1. executeToolCall() must be called with `canUseTool`, never bypassing
 *      the policy/approval gate for an opencode-backed role.
 *   2. args.resume must be read — every invocation must NOT silently start a
 *      fresh session, discarding prior conversation context.
 *
 * @opencode-ai/sdk is mocked so these tests never spawn a real opencode
 * server or hit the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { AgentMessage, AgentRunArgs } from '../../src/orgrt/agent-runner.js';

/** A manually-driven async-iterable event stream, standing in for the SDK's
 *  `{ stream: AsyncGenerator<Event> }` from `client.event.subscribe()`.
 *  `push()` delivers an event to whichever `next()` call is currently
 *  awaiting one (or queues it if none is), so a test can interleave
 *  `promptAsync()` calls with scripted event delivery in real order. */
function makeEventStream() {
  const queue: unknown[] = [];
  const waiters: Array<(r: IteratorResult<unknown>) => void> = [];
  const stream = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next(): Promise<IteratorResult<unknown>> {
      if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
  return {
    stream,
    push(ev: unknown) {
      const w = waiters.shift();
      if (w) w({ value: ev, done: false });
      else queue.push(ev);
    },
  };
}

const sessionCreateMock = vi.fn();
const sessionGetMock = vi.fn();
const sessionPromptAsyncMock = vi.fn();
const eventSubscribeMock = vi.fn();
const createClientMock = vi.fn();
const serverCloseMock = vi.fn();

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: (...a: unknown[]) => {
    createClientMock(...a);
    return {
      session: { create: sessionCreateMock, get: sessionGetMock, promptAsync: sessionPromptAsyncMock },
      event: { subscribe: eventSubscribeMock },
    };
  },
}));

/** The ephemeral `opencode serve` child (#262): the runner spawns it itself so
 *  it can hand it the role's session env, then parses its listening line. */
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...a: unknown[]) => {
    spawnMock(...a);
    const listeners = new Map<string, Array<(...x: any[]) => void>>();
    const on = (ev: string, fn: (...x: any[]) => void) => {
      listeners.set(ev, [...(listeners.get(ev) ?? []), fn]);
      return { on };
    };
    const child = {
      stdout: { on },
      stderr: { on },
      on,
      kill: serverCloseMock,
    };
    // Announce the listening line on the next tick, the way the real binary
    // does once its HTTP server is up.
    setTimeout(() => {
      for (const fn of listeners.get('data') ?? [])
        fn(Buffer.from('opencode server listening on http://127.0.0.1:41234\n'));
    }, 0);
    return child;
  },
}));

import { OpencodeAgentRunner } from '../../src/orgrt/opencode-runner.js';

function makeArgs(overrides?: Partial<AgentRunArgs>): AgentRunArgs {
  return {
    tools: [],
    prompt: (async function* () {
      yield 'do work';
    })(),
    systemPrompt: 'test role',
    cwd: '/tmp',
    env: {},
    maxTurns: 5,
    ...overrides,
  };
}

async function collect(runner: OpencodeAgentRunner, args: AgentRunArgs): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];
  for await (const m of runner.run(args)) messages.push(m);
  return messages;
}

// ─── scripted event helpers (shapes confirmed live against a real server) ──

let seq = 0;
const uid = (prefix: string) => `${prefix}_${++seq}`;

function textPartUpdated(sessionID: string, messageID: string, partID: string, text: string) {
  return { type: 'message.part.updated', properties: { part: { id: partID, sessionID, messageID, type: 'text', text } } };
}
function userMessageEcho(sessionID: string, messageID: string, partID: string, text: string) {
  // The real server always echoes the user's OWN message + its own text
  // part back through the event stream BEFORE creating the assistant
  // message that replies to it — confirmed live. Not something this
  // runner should ever surface as assistant output.
  return [
    { type: 'message.updated', properties: { info: { id: messageID, sessionID, role: 'user', time: { created: Date.now() } } } },
    { type: 'message.part.updated', properties: { part: { id: partID, sessionID, messageID, type: 'text', text } } },
  ];
}
function reasoningPartUpdated(sessionID: string, messageID: string, partID: string, text: string) {
  return { type: 'message.part.updated', properties: { part: { id: partID, sessionID, messageID, type: 'reasoning', text } } };
}
function partDelta(sessionID: string, messageID: string, partID: string, delta: string) {
  return { type: 'message.part.delta', properties: { sessionID, messageID, partID, field: 'text', delta } };
}
function assistantMessageCreated(sessionID: string, messageID: string) {
  return {
    type: 'message.updated',
    properties: { info: { id: messageID, sessionID, role: 'assistant', time: { created: Date.now() }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 } },
  };
}
function assistantMessageCompleted(
  sessionID: string,
  messageID: string,
  usage: { input: number; output: number },
  cost = 0,
) {
  return {
    type: 'message.updated',
    properties: {
      info: {
        id: messageID,
        sessionID,
        role: 'assistant',
        time: { created: Date.now(), completed: Date.now() },
        tokens: { input: usage.input, output: usage.output, reasoning: 0, cache: { read: 0, write: 0 } },
        cost,
      },
    },
  };
}

beforeEach(() => {
  seq = 0;
  sessionCreateMock.mockReset();
  sessionGetMock.mockReset();
  sessionPromptAsyncMock.mockReset().mockResolvedValue(undefined);
  eventSubscribeMock.mockReset();
  createClientMock.mockReset();
  spawnMock.mockReset();
  serverCloseMock.mockReset();
  delete process.env.OPENCODE_URL;
});

describe('OpencodeAgentRunner', () => {
  it('creates a fresh session when args.resume is absent', async () => {
    sessionCreateMock.mockResolvedValue({ data: { id: 'session_fresh' } });
    const es = makeEventStream();
    eventSubscribeMock.mockResolvedValue({ stream: es.stream });
    sessionPromptAsyncMock.mockImplementation(async () => {
      const mid = uid('msg');
      es.push(assistantMessageCreated('session_fresh', mid));
      es.push(textPartUpdated('session_fresh', mid, uid('prt'), 'hello'));
      es.push(assistantMessageCompleted('session_fresh', mid, { input: 1, output: 1 }));
    });

    await collect(new OpencodeAgentRunner(), makeArgs());

    expect(sessionCreateMock).toHaveBeenCalledTimes(1);
    expect(sessionGetMock).not.toHaveBeenCalled();
    expect(sessionPromptAsyncMock.mock.calls[0][0].path).toEqual({ id: 'session_fresh' });
  });

  it('resumes an existing session via session.get instead of creating a new one', async () => {
    sessionGetMock.mockResolvedValue({ data: { id: 'session_resumed' } });
    const es = makeEventStream();
    eventSubscribeMock.mockResolvedValue({ stream: es.stream });
    sessionPromptAsyncMock.mockImplementation(async () => {
      const mid = uid('msg');
      es.push(assistantMessageCreated('session_resumed', mid));
      es.push(textPartUpdated('session_resumed', mid, uid('prt'), 'hello'));
      es.push(assistantMessageCompleted('session_resumed', mid, { input: 1, output: 1 }));
    });

    await collect(new OpencodeAgentRunner(), makeArgs({ resume: 'session_resumed' }));

    expect(sessionGetMock).toHaveBeenCalledWith({ path: { id: 'session_resumed' } });
    expect(sessionCreateMock).not.toHaveBeenCalled();
    expect(sessionPromptAsyncMock.mock.calls[0][0].path).toEqual({ id: 'session_resumed' });
  });

  it('never surfaces the echoed user message/part as assistant output, even though it arrives before assistantMessageId is known', async () => {
    // Regression test for a bug caught live (not by the mocks below, which
    // is exactly why this test exists): the real server always echoes the
    // user's own message + text part back through the SAME event stream
    // before creating the assistant's reply. A filter that only starts
    // rejecting non-matching messageIDs once assistantMessageId is known —
    // i.e. lets anything through while it's still unknown — records the
    // user's own prompt text as if it were a real (unstreamed) text part,
    // which then leaks out as a fake final "assistant" message once the
    // round-end reconciliation finds it was never marked as already shown.
    sessionCreateMock.mockResolvedValue({ data: { id: 's1' } });
    const es = makeEventStream();
    eventSubscribeMock.mockResolvedValue({ stream: es.stream });
    sessionPromptAsyncMock.mockImplementation(async () => {
      const userMid = uid('msg');
      const userPid = uid('prt');
      for (const ev of userMessageEcho('s1', userMid, userPid, 'the original prompt text')) es.push(ev);
      const mid = uid('msg');
      const pid = uid('prt');
      es.push(assistantMessageCreated('s1', mid));
      es.push(textPartUpdated('s1', mid, pid, ''));
      es.push(partDelta('s1', mid, pid, 'Real reply.'));
      es.push(textPartUpdated('s1', mid, pid, 'Real reply.'));
      es.push(assistantMessageCompleted('s1', mid, { input: 1, output: 1 }));
    });

    const messages = await collect(new OpencodeAgentRunner(), makeArgs());
    const assistant = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(assistant.join('')).toBe('Real reply.');
    expect(assistant.some((t) => t?.includes('original prompt text'))).toBe(false);
  });

  it('streams each text-part delta as its own incremental message instead of waiting for the part to finish, when extras.includePartialMessages opts in', async () => {
    sessionCreateMock.mockResolvedValue({ data: { id: 's1' } });
    const es = makeEventStream();
    eventSubscribeMock.mockResolvedValue({ stream: es.stream });
    sessionPromptAsyncMock.mockImplementation(async () => {
      const userMid = uid('msg');
      const userPid = uid('prt');
      for (const ev of userMessageEcho('s1', userMid, userPid, 'do work')) es.push(ev);
      const mid = uid('msg');
      const pid = uid('prt');
      es.push(assistantMessageCreated('s1', mid));
      es.push(textPartUpdated('s1', mid, pid, ''));
      es.push(partDelta('s1', mid, pid, 'Hello'));
      es.push(partDelta('s1', mid, pid, ' world'));
      es.push(textPartUpdated('s1', mid, pid, 'Hello world'));
      es.push(assistantMessageCompleted('s1', mid, { input: 10, output: 5 }));
    });

    const messages = await collect(new OpencodeAgentRunner(), makeArgs({ extras: { includePartialMessages: true } }));

    const assistant = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(assistant).toEqual(['Hello', ' world']);
    expect(assistant.join('')).toBe('Hello world');
    const result = messages.find((m) => m.type === 'result');
    expect(result?.input_tokens).toBe(10);
    expect(result?.output_tokens).toBe(5);
  });

  it('without extras.includePartialMessages, waits for the part to finish and yields one message (session.ts default)', async () => {
    sessionCreateMock.mockResolvedValue({ data: { id: 's1' } });
    const es = makeEventStream();
    eventSubscribeMock.mockResolvedValue({ stream: es.stream });
    sessionPromptAsyncMock.mockImplementation(async () => {
      const userMid = uid('msg');
      const userPid = uid('prt');
      for (const ev of userMessageEcho('s1', userMid, userPid, 'do work')) es.push(ev);
      const mid = uid('msg');
      const pid = uid('prt');
      es.push(assistantMessageCreated('s1', mid));
      es.push(textPartUpdated('s1', mid, pid, ''));
      es.push(partDelta('s1', mid, pid, 'Hello'));
      es.push(partDelta('s1', mid, pid, ' world'));
      es.push(textPartUpdated('s1', mid, pid, 'Hello world'));
      es.push(assistantMessageCompleted('s1', mid, { input: 10, output: 5 }));
    });

    const messages = await collect(new OpencodeAgentRunner(), makeArgs()); // no extras

    const assistant = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(assistant).toEqual(['Hello world']);
  });

  it('excludes reasoning-part deltas from visible text — only field:text deltas on a type:text part are shown', async () => {
    sessionCreateMock.mockResolvedValue({ data: { id: 's1' } });
    const es = makeEventStream();
    eventSubscribeMock.mockResolvedValue({ stream: es.stream });
    sessionPromptAsyncMock.mockImplementation(async () => {
      const mid = uid('msg');
      const reasoningId = uid('prt');
      const textId = uid('prt');
      es.push(assistantMessageCreated('s1', mid));
      es.push(reasoningPartUpdated('s1', mid, reasoningId, ''));
      es.push(partDelta('s1', mid, reasoningId, 'thinking about it'));
      es.push(reasoningPartUpdated('s1', mid, reasoningId, 'thinking about it'));
      es.push(textPartUpdated('s1', mid, textId, ''));
      es.push(partDelta('s1', mid, textId, 'Final answer.'));
      es.push(textPartUpdated('s1', mid, textId, 'Final answer.'));
      es.push(assistantMessageCompleted('s1', mid, { input: 1, output: 1 }));
    });

    const messages = await collect(new OpencodeAgentRunner(), makeArgs());
    const assistant = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(assistant.join('')).toBe('Final answer.');
    expect(assistant.some((t) => t?.includes('thinking'))).toBe(false);
  });

  it('threads canUseTool through to executeToolCall — a deny decision blocks the real handler', async () => {
    sessionCreateMock.mockResolvedValue({ data: { id: 'session_fence' } });
    const handled: string[] = [];
    const canUseToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const es = makeEventStream();
    eventSubscribeMock.mockResolvedValue({ stream: es.stream });

    // First prompt() call: model emits a tool_call fence. Second call (once
    // the tool result is fed back): a plain final reply, ending the loop.
    sessionPromptAsyncMock.mockImplementation(async (opts: any) => {
      const text = String(opts?.body?.parts?.[0]?.text ?? '');
      const mid = uid('msg');
      const pid = uid('prt');
      es.push(assistantMessageCreated('session_fence', mid));
      if (text.includes('tool_result')) {
        es.push(textPartUpdated('session_fence', mid, pid, ''));
        es.push(partDelta('session_fence', mid, pid, 'final answer'));
        es.push(textPartUpdated('session_fence', mid, pid, 'final answer'));
      } else {
        const fenceText = 'Sending now.\n```tool_call\n{"name":"org_echo","arguments":{"text":"hi"}}\n```';
        es.push(textPartUpdated('session_fence', mid, pid, ''));
        es.push(partDelta('session_fence', mid, pid, fenceText));
        es.push(textPartUpdated('session_fence', mid, pid, fenceText));
      }
      es.push(assistantMessageCompleted('session_fence', mid, { input: 1, output: 1 }));
    });

    const args = makeArgs({
      tools: [
        {
          name: 'org_echo',
          description: 'echo text back',
          schema: { text: z.string() },
          handler: async (a) => {
            handled.push(String(a.text));
            return { text: `echo:${a.text}` };
          },
        },
      ],
      canUseTool: async (name, input) => {
        canUseToolCalls.push({ name, input });
        return { behavior: 'deny', message: 'blocked by policy' };
      },
    });

    await collect(new OpencodeAgentRunner(), args);

    // canUseTool was consulted with the parsed tool call's name + args…
    expect(canUseToolCalls).toEqual([{ name: 'org_echo', input: { text: 'hi' } }]);
    // …and its deny decision short-circuited BEFORE the real handler ran.
    expect(handled).toEqual([]);

    // The denial (not the handler's echo result) is what got fed back as the
    // next prompt.
    expect(sessionPromptAsyncMock).toHaveBeenCalledTimes(2);
    const secondPromptText = String(sessionPromptAsyncMock.mock.calls[1][0]?.body?.parts?.[0]?.text ?? '');
    expect(secondPromptText).toContain('denied by policy');
    expect(secondPromptText).not.toContain('echo:hi');
  });

  it('runs the real handler and feeds its result back when canUseTool allows the call', async () => {
    sessionCreateMock.mockResolvedValue({ data: { id: 'session_allow' } });
    const handled: string[] = [];
    const es = makeEventStream();
    eventSubscribeMock.mockResolvedValue({ stream: es.stream });

    sessionPromptAsyncMock.mockImplementation(async (opts: any) => {
      const text = String(opts?.body?.parts?.[0]?.text ?? '');
      const mid = uid('msg');
      const pid = uid('prt');
      es.push(assistantMessageCreated('session_allow', mid));
      const fullText = text.includes('tool_result')
        ? 'final answer'
        : '```tool_call\n{"name":"org_echo","arguments":{"text":"hi"}}\n```';
      es.push(textPartUpdated('session_allow', mid, pid, ''));
      es.push(partDelta('session_allow', mid, pid, fullText));
      es.push(textPartUpdated('session_allow', mid, pid, fullText));
      es.push(assistantMessageCompleted('session_allow', mid, { input: 1, output: 1 }));
    });

    const args = makeArgs({
      tools: [
        {
          name: 'org_echo',
          description: 'echo text back',
          schema: { text: z.string() },
          handler: async (a) => {
            handled.push(String(a.text));
            return { text: `echo:${a.text}` };
          },
        },
      ],
      canUseTool: async () => ({ behavior: 'allow' }),
    });

    await collect(new OpencodeAgentRunner(), args);

    expect(handled).toEqual(['hi']);
    const secondPromptText = String(sessionPromptAsyncMock.mock.calls[1][0]?.body?.parts?.[0]?.text ?? '');
    expect(secondPromptText).toContain('echo:hi');
  });

  // ─── #262: the session env must reach the process that runs the shell ────

  const oneTurn = (sessionId: string) => {
    sessionCreateMock.mockResolvedValue({ data: { id: sessionId } });
    const es = makeEventStream();
    eventSubscribeMock.mockResolvedValue({ stream: es.stream });
    sessionPromptAsyncMock.mockImplementation(async () => {
      const mid = uid('msg');
      es.push(assistantMessageCreated(sessionId, mid));
      es.push(textPartUpdated(sessionId, mid, uid('prt'), 'ok'));
      es.push(assistantMessageCompleted(sessionId, mid, { input: 1, output: 1 }));
    });
  };

  it('passes the session env (provider credentials, #249 scoping, the #258 git guard) to the ephemeral server, merged over process.env', async () => {
    oneTurn('s_env');
    await collect(
      new OpencodeAgentRunner(),
      makeArgs({
        cwd: '/tmp/role-cwd',
        env: {
          ANTHROPIC_BASE_URL: 'https://role-endpoint.invalid',
          GIT_CONFIG_COUNT: '2',
          MONOMIND_GIT_LEVEL: 'read',
          GIT_ASKPASS: '/guard/deny-credentials',
        },
      }),
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, argv, opts] = spawnMock.mock.calls[0] as [string, string[], any];
    expect(bin).toBe('opencode');
    expect(argv[0]).toBe('serve');
    expect(opts.cwd).toBe('/tmp/role-cwd');
    expect(opts.env.ANTHROPIC_BASE_URL).toBe('https://role-endpoint.invalid');
    expect(opts.env.MONOMIND_GIT_LEVEL).toBe('read');
    expect(opts.env.GIT_ASKPASS).toBe('/guard/deny-credentials');
    // merged OVER process.env, not instead of it
    expect(opts.env.PATH).toBe(process.env.PATH);
    // the client talks to the server we just started
    expect(createClientMock.mock.calls[0][0].baseUrl).toBe('http://127.0.0.1:41234');
  });

  it('attaches to OPENCODE_URL without spawning a server — that one cannot be given the env (#262)', async () => {
    process.env.OPENCODE_URL = 'http://127.0.0.1:4096';
    oneTurn('s_attached');
    await collect(new OpencodeAgentRunner(), makeArgs({ env: { MONOMIND_GIT_LEVEL: 'read' } }));

    expect(spawnMock).not.toHaveBeenCalled();
    expect(createClientMock.mock.calls[0][0].baseUrl).toBe('http://127.0.0.1:4096');
  });
});
