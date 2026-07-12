// packages/@monomind/cli/__tests__/orgrt/session.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession, buildRolePrompt } from '../../src/orgrt/session.js';

const dir = () => mkdtempSync(join(tmpdir(), 'sess-'));

describe('runAgentSession', () => {
  it('emits chat events for assistant text and usage on result', async () => {
    const bus = new OrgBus('o', 'r', dir());
    const events: string[] = [];
    bus.subscribe(e => events.push(e.type));
    const mailbox = new Mailbox();
    mailbox.push('do the thing'); mailbox.close();

    const fakeQuery = ({ prompt, options }: any) => (async function* () {
      // drain input like the real SDK does
      for await (const _ of prompt) break;
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001 };
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    await runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    expect(events).toContain('chat');
    expect(events).toContain('usage');
    expect(policy.usage).toBe(15);
  });

  it('buildRolePrompt names the role, goal, and org_send protocol', () => {
    const p = buildRolePrompt(
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: ['write code'] } as any,
      { name: 'my-org', goal: 'ship v2' } as any,
      ['boss', 'coder', 'tester'],
    );
    expect(p).toContain('coder');
    expect(p).toContain('ship v2');
    expect(p).toContain('org_send');
    expect(p).toContain('boss, coder, tester');
  });
});
