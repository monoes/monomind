// packages/@monomind/cli/__tests__/orgrt/policy-hook.test.ts
/**
 * The Claude SDK calls canUseTool only for calls its own rules would ask
 * about: read-only Bash, Read inside the cwd, Agent, ToolSearch and the like
 * are auto-allowed without it. policy-hook.ts puts the org gate on the
 * PreToolUse hook, which fires for every call, and keeps canUseTool from
 * deciding (and auditing) the same call twice.
 */
import { describe, expect, it, vi } from 'vitest';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner.js';
import { coverEveryToolCall } from '../../src/orgrt/policy-hook.js';

const allow = (input: Record<string, unknown>) => ({ behavior: 'allow', updatedInput: input });
const pre = (tool_name: string, tool_input: Record<string, unknown>, tool_use_id?: string) => ({
  hook_event_name: 'PreToolUse',
  tool_name,
  tool_input,
  tool_use_id,
});

describe('coverEveryToolCall', () => {
  it('denies through the PreToolUse hook what the gate denies', async () => {
    const gate = vi.fn(async () => ({ behavior: 'deny', message: '[org-policy] no' }));
    const { preToolUse } = coverEveryToolCall(gate);
    const out = await preToolUse(pre('Bash', { command: 'cat f' }, 'toolu_1'));
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '[org-policy] no',
      },
    });
    expect(gate).toHaveBeenCalledWith('Bash', { command: 'cat f' }, { toolUseId: 'toolu_1' });
  });

  it("leaves an allowed call to the SDK's own permission flow", async () => {
    const { preToolUse } = coverEveryToolCall(async (_t, input) => allow(input));
    expect(await preToolUse(pre('Read', { file_path: 'a' }, 'toolu_1'))).toEqual({});
  });

  it('decides a call once when the SDK also asks canUseTool about it', async () => {
    const gate = vi.fn(async (_t: string, input: Record<string, unknown>) => allow(input));
    const { preToolUse, canUseTool } = coverEveryToolCall(gate);
    const input = { command: 'git commit -m x' };
    await preToolUse(pre('Bash', input, 'toolu_1'));
    expect(await canUseTool('Bash', input, { toolUseId: 'toolu_1' })).toEqual(allow(input));
    expect(gate).toHaveBeenCalledTimes(1);
    // Consumed: a second ask for the same id decides again.
    await canUseTool('Bash', input, { toolUseId: 'toolu_1' });
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it('decides again when the input changed between the hook and canUseTool', async () => {
    const gate = vi.fn(async (_t: string, input: Record<string, unknown>) => allow(input));
    const { preToolUse, canUseTool } = coverEveryToolCall(gate);
    await preToolUse(pre('Bash', { command: 'ls' }, 'toolu_1'));
    await canUseTool('Bash', { command: 'rm -rf x' }, { toolUseId: 'toolu_1' });
    expect(gate).toHaveBeenCalledTimes(2);
    expect(gate).toHaveBeenLastCalledWith('Bash', { command: 'rm -rf x' }, { toolUseId: 'toolu_1' });
  });

  it('decides in canUseTool when the hook never ran for the call', async () => {
    const gate = vi.fn(async (_t: string, input: Record<string, unknown>) => allow(input));
    const { canUseTool } = coverEveryToolCall(gate);
    await canUseTool('Bash', { command: 'ls' }, { toolUseId: 'toolu_9' });
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('keeps no unbounded record of calls the SDK auto-allowed', async () => {
    const gate = vi.fn(async (_t: string, input: Record<string, unknown>) => allow(input));
    const { preToolUse, canUseTool } = coverEveryToolCall(gate);
    for (let i = 0; i < 1000; i++) await preToolUse(pre('Read', { i }, `toolu_${i}`));
    // The newest is still remembered, the oldest was dropped.
    await canUseTool('Read', { i: 999 }, { toolUseId: 'toolu_999' });
    expect(gate).toHaveBeenCalledTimes(1000);
    await canUseTool('Read', { i: 0 }, { toolUseId: 'toolu_0' });
    expect(gate).toHaveBeenCalledTimes(1001);
  });
});

describe('ClaudeAgentRunner', () => {
  async function optionsFor(args: Record<string, unknown>) {
    let options: any;
    const queryFn = ((q: { options: unknown }) => {
      options = q.options;
      return (async function* () {})();
    }) as never;
    for await (const _ of new ClaudeAgentRunner(queryFn).run({
      tools: [],
      prompt: (async function* () {})(),
      systemPrompt: '',
      cwd: '/',
      env: {},
      maxTurns: 1,
      ...args,
    })) {
      /* drain */
    }
    return options;
  }

  it('puts the permission gate on PreToolUse as well as canUseTool', async () => {
    const gate = vi.fn(async () => ({ behavior: 'deny', message: 'no' }));
    const options = await optionsFor({ canUseTool: gate, toolSpillDir: '/tmp/spill' });
    expect(options.hooks.PostToolUse).toHaveLength(1);
    const [matcher] = options.hooks.PreToolUse;
    const out = await matcher.hooks[0](pre('Bash', { command: 'ls' }, 'toolu_1'), 'toolu_1', {});
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(gate).toHaveBeenCalledTimes(1);
    expect(await options.canUseTool('Bash', { command: 'ls' }, { toolUseID: 'toolu_1' })).toEqual({
      behavior: 'deny',
      message: 'no',
    });
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('installs no PreToolUse hook without a gate', async () => {
    const options = await optionsFor({});
    expect(options.hooks).toBeUndefined();
    expect(options.canUseTool).toBeUndefined();
  });
});
