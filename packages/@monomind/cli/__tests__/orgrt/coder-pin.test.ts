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
    const pin = coderPin({ model: 'claude-sonnet-5-5', effort: 'medium' })!;
    expect(pin.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('medium');
    expect(pin.settings.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('medium');
    expect(pin.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('claude-sonnet-5-5');
  });

  it('pins nothing when no model or effort was selected, or effort is off', () => {
    expect(coderPin({})).toBeUndefined();
    expect(coderPin({ model: 'default', effort: 'off' })).toBeUndefined();
  });

  it('refuses an Agent launch on a different model, allows the selected one', async () => {
    const pin = coderPin({ model: 'claude-sonnet-5-5' })!;
    const denied = await pin.preToolUse(agent({ model: 'opus' }));
    expect((denied.hookSpecificOutput as any).permissionDecision).toBe('deny');
    expect(await pin.preToolUse(agent({ model: 'sonnet' }))).toEqual({});
    expect(await pin.preToolUse(agent({ model: 'claude-sonnet-5-5' }))).toEqual({});
    expect(await pin.preToolUse(agent({ prompt: 'x' }))).toEqual({});
    expect(await pin.preToolUse(agent({ model: 'fable' }, 'Task'))).not.toEqual({});
    expect(await pin.preToolUse(agent({ model: 'opus' }, 'Bash'))).toEqual({});
  });
});
