import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { runAgentSession } from '../../src/orgrt/session.js';

// Recorded Claude blocks share the response's message.id and message.usage.
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 3 };
const assistant = (id?: string, parent?: string) => ({
  type: 'assistant', session_id: 'sdk-session', parent_tool_use_id: parent ?? null,
  message: { id, content: [{ type: 'text', text: 'reply' }], usage },
});

async function run(messages: object[], responses: number) {
  const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'token-dedup-')));
  const events: Record<string, unknown>[] = [];
  const chats: string[] = [];
  bus.subscribe((event) => {
    if (event.type === 'usage') events.push(event.data ?? {});
    if (event.type === 'chat') chats.push(event.msg ?? '');
  });
  const mailbox = new Mailbox();
  mailbox.push('work');
  const policy = new PolicyEngine('coder', { maxTokens: responses * 38 + 1, maxTokensBasis: 'billable' }, bus, '/work');
  const queryFn = ({ prompt }: any) => (async function* () {
    for await (const _ of prompt) break;
    for (const message of messages) yield message;
    // Observe the live meter before result settlement can top it up.
    expect(policy.usage).toBe(responses * 38);
    expect(mailbox.isClosed).toBe(false);
    yield {
      type: 'result', session_id: 'sdk-session', subtype: 'success',
      modelUsage: { claude: {
        inputTokens: responses * 10, outputTokens: responses * 5,
        cacheReadInputTokens: responses * 20, cacheCreationInputTokens: responses * 3,
      } },
    };
    mailbox.close();
  })();
  await runAgentSession({
    org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', responsibilities: [] },
    bus, policy, mailbox, cwd: '/work', deliver: async () => 'delivered', queryFn: queryFn as any,
  });
  expect(policy.tokenUsage).toEqual({ input: responses * 10, output: responses * 5, cacheRead: responses * 20, cacheCreation: responses * 3 });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ tokens: responses * 38, tokens_in: responses * 10, tokens_out: responses * 5, cache_read: responses * 20, cache_creation: responses * 3 });
  expect(chats).toHaveLength(messages.length);
}

describe('assistant response token accounting (#597)', () => {
  it('preserves response IDs and repeated usage through Claude SDK normalization', async () => {
    const queryFn = () => (async function* () {
      yield assistant('main-1');
      yield assistant('main-1');
      yield assistant('child-1', 'task-1');
    })();
    const runner = new ClaudeAgentRunner(queryFn as any);
    const messages = [];
    for await (const message of runner.run({
      tools: [], prompt: (async function* () {})(), systemPrompt: '',
      cwd: '/work', env: {}, maxTurns: 5,
    })) messages.push(message);
    expect(messages.map((message) => message.response_id)).toEqual(['main-1', 'main-1', 'child-1']);
    expect(messages[2].parent_tool_use_id).toBe('task-1');
    for (const message of messages) expect(message).toMatchObject(usage);
  });

  it('counts split response blocks once live and on settlement, including subagents', async () => {
    await run([
      assistant('main-1'), assistant('main-1'),
      assistant('child-1', 'task-1'), assistant('child-1', 'task-1'),
      assistant('main-2'), assistant('main-1'),
    ], 3);
  });

  it('keeps counting messages from runners without response IDs', async () => {
    await run([assistant(), assistant()], 2);
  });

  it('does not mark a usage-free block as already metered', async () => {
    await run([
      { ...assistant('main-1'), message: { ...assistant('main-1').message, usage: {} } },
      assistant('main-1'),
    ], 1);
  });
});
