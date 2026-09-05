/**
 * Unit tests for OpencodeAgentRunner (opencode-runner.ts).
 *
 * Regression coverage for two bugs found by swarm review of Org Runtime v2:
 *   1. executeToolCall() was called without `canUseTool`, silently bypassing
 *      the policy/approval gate for every opencode-backed role.
 *   2. args.resume was never read — every invocation started a fresh
 *      opencode session, discarding prior conversation context.
 *
 * @opencode-ai/sdk is mocked so these tests never spawn a real opencode
 * server or hit the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { AgentMessage, AgentRunArgs } from '../../src/orgrt/agent-runner.js';

const sessionCreateMock = vi.fn();
const sessionGetMock = vi.fn();
const sessionPromptMock = vi.fn();
const serverCloseMock = vi.fn();

vi.mock('@opencode-ai/sdk', () => ({
  createOpencode: vi.fn(async () => ({
    client: {
      session: {
        create: sessionCreateMock,
        get: sessionGetMock,
        prompt: sessionPromptMock,
      },
    },
    server: { url: 'http://127.0.0.1:0', close: serverCloseMock },
  })),
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

beforeEach(() => {
  sessionCreateMock.mockReset();
  sessionGetMock.mockReset();
  sessionPromptMock.mockReset();
  serverCloseMock.mockReset();
});

describe('OpencodeAgentRunner', () => {
  it('creates a fresh session when args.resume is absent', async () => {
    sessionCreateMock.mockResolvedValue({ data: { id: 'session_fresh' } });
    sessionPromptMock.mockResolvedValue({
      data: { info: {}, parts: [{ type: 'text', text: 'hello' }] },
    });

    await collect(new OpencodeAgentRunner(), makeArgs());

    expect(sessionCreateMock).toHaveBeenCalledTimes(1);
    expect(sessionGetMock).not.toHaveBeenCalled();
    expect(sessionPromptMock.mock.calls[0][0].path).toEqual({ id: 'session_fresh' });
  });

  it('resumes an existing session via session.get instead of creating a new one', async () => {
    sessionGetMock.mockResolvedValue({ data: { id: 'session_resumed' } });
    sessionPromptMock.mockResolvedValue({
      data: { info: {}, parts: [{ type: 'text', text: 'hello' }] },
    });

    await collect(new OpencodeAgentRunner(), makeArgs({ resume: 'session_resumed' }));

    expect(sessionGetMock).toHaveBeenCalledWith({ path: { id: 'session_resumed' } });
    expect(sessionCreateMock).not.toHaveBeenCalled();
    expect(sessionPromptMock.mock.calls[0][0].path).toEqual({ id: 'session_resumed' });
  });

  it('threads canUseTool through to executeToolCall — a deny decision blocks the real handler', async () => {
    sessionCreateMock.mockResolvedValue({ data: { id: 'session_fence' } });
    const handled: string[] = [];
    const canUseToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

    // First prompt() call: model emits a tool_call fence. Second call (once
    // the tool result is fed back): a plain final reply, ending the loop.
    sessionPromptMock.mockImplementation(async (opts: any) => {
      const text = String(opts?.body?.parts?.[0]?.text ?? '');
      if (text.includes('tool_result')) {
        return { data: { info: {}, parts: [{ type: 'text', text: 'final answer' }] } };
      }
      return {
        data: {
          info: {},
          parts: [
            {
              type: 'text',
              text: 'Sending now.\n```tool_call\n{"name":"org_echo","arguments":{"text":"hi"}}\n```',
            },
          ],
        },
      };
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
    expect(sessionPromptMock).toHaveBeenCalledTimes(2);
    const secondPromptText = String(sessionPromptMock.mock.calls[1][0]?.body?.parts?.[0]?.text ?? '');
    expect(secondPromptText).toContain('denied by policy');
    expect(secondPromptText).not.toContain('echo:hi');
  });

  it('runs the real handler and feeds its result back when canUseTool allows the call', async () => {
    sessionCreateMock.mockResolvedValue({ data: { id: 'session_allow' } });
    const handled: string[] = [];

    sessionPromptMock.mockImplementation(async (opts: any) => {
      const text = String(opts?.body?.parts?.[0]?.text ?? '');
      if (text.includes('tool_result')) {
        return { data: { info: {}, parts: [{ type: 'text', text: 'final answer' }] } };
      }
      return {
        data: {
          info: {},
          parts: [
            {
              type: 'text',
              text: '```tool_call\n{"name":"org_echo","arguments":{"text":"hi"}}\n```',
            },
          ],
        },
      };
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
    const secondPromptText = String(sessionPromptMock.mock.calls[1][0]?.body?.parts?.[0]?.text ?? '');
    expect(secondPromptText).toContain('echo:hi');
  });
});
