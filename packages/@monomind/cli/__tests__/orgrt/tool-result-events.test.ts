// packages/@monomind/cli/__tests__/orgrt/tool-result-events.test.ts
/**
 * Issue #289: a role's tool call reached the bus exactly once, at invocation
 * (`{type:'tool', decision:'allow'}`). Nothing carried the result, so a Bash
 * running a test suite looked identical whether the suite passed, failed, or
 * the binary was missing — every consumer had to infer success by matching the
 * agent's own prose, which is exactly the claim least worth trusting.
 *
 * A completed tool call now emits a follow-up `tool_result` event carrying the
 * outcome, correlated to the invocation by the harness's tool-use id.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { gatedCanUseTool, runAgentSession } from '../../src/orgrt/session.js';
import type { BusEvent, ToolResultEventData } from '../../src/orgrt/types.js';
import { TOOL_RESULT_OUTPUT_MAX_CHARS } from '../../src/orgrt/types.js';

const dir = () => mkdtempSync(join(tmpdir(), 'toolres-'));
const role = { id: 'coder', title: 'Coder', type: 'specialist', responsibilities: [] } as any;

/** A fake SDK stream: one assistant turn with `calls` tool_use blocks, then one
 *  user message carrying the matching tool_result blocks, then a result. */
function fakeSdk(
  calls: Array<{ id: string; name: string }>,
  results: Array<{ id: string; is_error?: boolean; content: unknown }>,
) {
  return ({ prompt }: any) =>
    (async function* () {
      for await (const _ of prompt) break;
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'running the suite' },
            ...calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: {} })),
          ],
        },
      };
      yield {
        type: 'user',
        message: {
          content: results.map((r) => ({
            type: 'tool_result',
            tool_use_id: r.id,
            is_error: r.is_error,
            content: r.content,
          })),
        },
      };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
}

async function runWith(
  calls: Array<{ id: string; name: string }>,
  results: Array<{ id: string; is_error?: boolean; content: unknown }>,
): Promise<BusEvent[]> {
  const bus = new OrgBus('o', 'r', dir());
  const events: BusEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const mailbox = new Mailbox();
  mailbox.push('go');
  mailbox.close();
  await runAgentSession({
    org: 'o',
    role,
    bus,
    policy: new PolicyEngine('coder', {}, bus, '/work'),
    mailbox,
    cwd: '/work',
    deliver: async () => 'delivered',
    queryFn: fakeSdk(calls, results) as any,
  });
  return events;
}

describe('tool_result bus events (#289)', () => {
  it('reports a failing command as a failure, not as another allow', async () => {
    const events = await runWith(
      [{ id: 'tu_1', name: 'Bash' }],
      [{ id: 'tu_1', is_error: true, content: 'FAIL github.com/x/y [build failed]' }],
    );
    const res = events.filter((e) => e.type === 'tool_result');
    expect(res).toHaveLength(1);
    expect(res[0].from).toBe('coder');
    expect(res[0].tool).toBe('Bash');
    const data = res[0].data as unknown as ToolResultEventData;
    expect(data.ok).toBe(false);
    expect(data.call_id).toBe('tu_1');
    expect(data.output).toContain('build failed');
    expect(typeof data.duration_ms).toBe('number');
  });

  it('reports a successful command as a success', async () => {
    const events = await runWith(
      [{ id: 'tu_1', name: 'Bash' }],
      [{ id: 'tu_1', content: 'ok\t0.4s' }],
    );
    const data = events.find((e) => e.type === 'tool_result')
      ?.data as unknown as ToolResultEventData;
    expect(data.ok).toBe(true);
    expect(data.output).toContain('ok');
  });

  it('correlates by id, not by name, when the same tool runs twice', async () => {
    const events = await runWith(
      [
        { id: 'tu_a', name: 'Bash' },
        { id: 'tu_b', name: 'Bash' },
      ],
      [
        { id: 'tu_b', is_error: true, content: 'second failed' },
        { id: 'tu_a', content: 'first passed' },
      ],
    );
    const byId = new Map(
      events
        .filter((e) => e.type === 'tool_result')
        .map((e) => [(e.data as unknown as ToolResultEventData).call_id, e.data as any]),
    );
    expect(byId.get('tu_a').ok).toBe(true);
    expect(byId.get('tu_b').ok).toBe(false);
  });

  it('caps the carried output and says so, instead of putting megabytes on the bus', async () => {
    const huge = `head-marker${'x'.repeat(500_000)}`;
    const events = await runWith([{ id: 'tu_1', name: 'Bash' }], [{ id: 'tu_1', content: huge }]);
    const data = events.find((e) => e.type === 'tool_result')
      ?.data as unknown as ToolResultEventData;
    expect(data.truncated).toBe(true);
    expect(data.output_chars).toBe(huge.length);
    expect(data.output?.length).toBeLessThan(TOOL_RESULT_OUTPUT_MAX_CHARS + 100);
    expect(data.output).toContain('head-marker');
  });

  it('redacts secrets out of the carried output', async () => {
    const leak = 'exported AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY';
    const events = await runWith([{ id: 'tu_1', name: 'Bash' }], [{ id: 'tu_1', content: leak }]);
    const data = events.find((e) => e.type === 'tool_result')
      ?.data as unknown as ToolResultEventData;
    expect(data.output).not.toContain('wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY');
    expect(data.output).toContain('[REDACTED]');
  });

  it('stamps the invocation event with the same call_id the result carries', async () => {
    const bus = new OrgBus('o', 'r', dir());
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const policy = new PolicyEngine('coder', {}, bus, '/work');
    const gate = gatedCanUseTool(policy, undefined, 'coder');
    await gate('Bash', { command: 'ls' }, { toolUseId: 'tu_1' });
    const invocation = events.find((e) => e.type === 'tool');
    expect((invocation?.data as any).call_id).toBe('tu_1');
  });
});
