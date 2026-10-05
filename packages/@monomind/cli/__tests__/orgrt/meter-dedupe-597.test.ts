// packages/@monomind/cli/__tests__/orgrt/meter-dedupe-597.test.ts
//
// #597: one API response can reach the SDK stream as several assistant
// messages sharing one `message.id`. Each repeats the same input/cache usage,
// and output counts on the earlier ones can be placeholders. The live meter
// added every message, so the growth runs were metered at ~2x their tokens,
// and the result-time settle only ever tops up, never corrects downward.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';

const dir = () => mkdtempSync(join(tmpdir(), 'meter-597-'));
const role = { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any;

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
const assistant = (id: string, usage: Usage, parent: string | null = null) => ({
  type: 'assistant',
  session_id: 'sdk-sess',
  parent_tool_use_id: parent,
  message: { id, content: [], usage },
});

/** Raw SDK messages for one mailbox message, through the Claude adapter into
 *  the meter. Returns the usage events' token totals and the policy meter. */
async function meter(raw: unknown[], modelUsage?: Record<string, unknown>) {
  const bus = new OrgBus('o', 'r', dir());
  const tokens: number[] = [];
  bus.subscribe((e) => {
    if (e.type === 'usage') tokens.push((e.data as { tokens: number }).tokens);
  });
  const mailbox = new Mailbox();
  mailbox.push('m0');
  const fakeQuery = ({ prompt }: any) =>
    (async function* () {
      await prompt[Symbol.asyncIterator]().next();
      for (const m of raw) yield m;
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'sdk-sess',
        usage: { input_tokens: 0, output_tokens: 0 },
        ...(modelUsage ? { modelUsage } : {}),
        total_cost_usd: 0.01,
      };
      mailbox.close();
    })();
  const policy = new PolicyEngine('coder', {}, bus, '/work');
  await runAgentSession({
    org: 'o', role, bus, policy, mailbox, cwd: '/work',
    deliver: async () => 'delivered',
    queryFn: fakeQuery as any,
  });
  return { tokens, policy };
}

const split: Usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 };

describe('#597 meter de-duplicates assistant usage by response id', () => {
  it('counts one response split across three messages once', async () => {
    const { tokens } = await meter([assistant('msg_a', split), assistant('msg_a', split), assistant('msg_a', split)]);
    expect(tokens).toEqual([1115]);
  });

  it('takes the final output of a response whose earlier messages carry placeholder output', async () => {
    const { tokens } = await meter([
      assistant('msg_a', { ...split, output_tokens: 1 }),
      assistant('msg_a', { ...split, output_tokens: 1 }),
      assistant('msg_a', { ...split, output_tokens: 40 }),
    ]);
    expect(tokens).toEqual([1150]);
  });

  it('sums distinct responses, including a subagent response', async () => {
    const { tokens } = await meter([
      assistant('msg_a', split),
      assistant('msg_a', split),
      assistant('msg_b', split),
      assistant('msg_c', split, 'toolu_1'),
    ]);
    expect(tokens).toEqual([3 * 1115]);
  });

  it('settles to the de-duplicated total when modelUsage matches it', async () => {
    const { tokens } = await meter([assistant('msg_a', split), assistant('msg_a', split)], {
      m: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 1000, cacheCreationInputTokens: 100 },
    });
    expect(tokens).toEqual([1115]);
  });

  it('keeps counting each message when the runner gives no response id', async () => {
    const noId = { ...assistant('x', split), message: { content: [], usage: split } };
    const { tokens } = await meter([noId, noId]);
    expect(tokens).toEqual([2 * 1115]);
  });
});
