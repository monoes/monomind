// #655: the selected coder model and effort stay authoritative.
import { describe, expect, it } from 'vitest';
import { coderPin } from '../../src/orgrt/coder-pin.js';

const agent = (tool_input: Record<string, unknown>, tool_name = 'Agent') => ({
  hook_event_name: 'PreToolUse',
  tool_name,
  tool_input,
});

describe('coderPin', () => {
  it('pins effort over a global max, in env and in inline settings', () => {
    const pin = coderPin({ model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(pin.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('medium');
    expect(pin.settings.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('medium');
    expect(pin.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('claude-sonnet-5-5');
  });

  it('pins nothing when no model or effort was selected, or effort is off', () => {
    expect(coderPin({}).env).toEqual({});
    expect(coderPin({ model: 'default', effort: 'off' }).env).toEqual({});
  });

  it('refuses an Agent launch on a different model, allows the selected one', async () => {
    const pin = coderPin({ model: 'claude-sonnet-5-5' });
    const denied = await pin.preToolUse(agent({ model: 'opus' }));
    expect((denied.hookSpecificOutput as any).permissionDecision).toBe('deny');
    expect(await pin.preToolUse(agent({ model: 'sonnet' }))).toEqual({});
    expect(await pin.preToolUse(agent({ model: 'claude-sonnet-5-5' }))).toEqual({});
    expect(await pin.preToolUse(agent({ prompt: 'x' }))).toEqual({});
    expect(await pin.preToolUse(agent({ model: 'fable' }, 'Task'))).not.toEqual({});
    expect(await pin.preToolUse(agent({ model: 'opus' }, 'Bash'))).toEqual({});
  });

  it('caps agent launches and review launches, and the env raises or lifts the caps', async () => {
    const pin = coderPin({}, { MONOMIND_CODER_MAX_AGENTS: '3', MONOMIND_CODER_MAX_REVIEW_AGENTS: '1' });
    expect(await pin.preToolUse(agent({ description: 'Review task 1' }))).toEqual({});
    const reviewDenied = await pin.preToolUse(agent({ description: 'Re-review task 1' }));
    expect((reviewDenied.hookSpecificOutput as any).permissionDecisionReason).toContain('review limit');
    expect(await pin.preToolUse(agent({ description: 'implement a' }))).toEqual({});
    expect(await pin.preToolUse(agent({ description: 'implement b' }))).toEqual({});
    const full = await pin.preToolUse(agent({ description: 'implement c' }));
    expect((full.hookSpecificOutput as any).permissionDecisionReason).toContain('delegation limit');
    expect(pin.launches()).toEqual({ total: 3, review: 1 });
    const open = coderPin({}, { MONOMIND_CODER_MAX_AGENTS: '0', MONOMIND_CODER_MAX_REVIEW_AGENTS: '0' });
    for (let i = 0; i < 100; i++) expect(await open.preToolUse(agent({ description: 'review x' }))).toEqual({});
  });
});
