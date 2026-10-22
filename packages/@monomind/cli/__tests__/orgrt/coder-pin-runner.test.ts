// #655: the coder-mode pin as the SDK actually receives it, including a resumed
// run, ambient global effort `max`, and a skill asking for another model.
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner-claude.js';

const saved = process.env.CLAUDE_CODE_EFFORT_LEVEL;
afterEach(() => {
  if (saved === undefined) delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
  else process.env.CLAUDE_CODE_EFFORT_LEVEL = saved;
});

async function run(extra: Record<string, unknown>) {
  let options: any;
  const queryFn = ((q: { options: any }) => {
    options = q.options;
    return (async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
    })();
  }) as never;
  for await (const _ of new ClaudeAgentRunner(queryFn).run({
    tools: [], prompt: (async function* () {})(), systemPrompt: '', cwd: '/', env: {}, maxTurns: 1, ...extra,
  } as any)) void _;
  return options;
}

const hookOf = (o: any) => o.hooks.PreToolUse.flatMap((g: any) => g.hooks);
const launch = (model: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { model, description: 'implement' } });

describe('coder pin reaches the SDK query', () => {
  for (const resume of [undefined, 'sess-1']) {
    it(`global max + selected medium sends medium (resume=${resume})`, async () => {
      process.env.CLAUDE_CODE_EFFORT_LEVEL = 'max';
      const o = await run({ settingSources: ['user', 'project', 'local'], model: 'claude-sonnet-5-5', effort: 'medium', resume });
      expect(o.effort).toBe('medium');
      expect(o.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('medium');
      expect(o.settings.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('medium');
      expect(o.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('claude-sonnet-5-5');
      expect(o.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE).toBe('1');
      expect(o.resume).toBe(resume);
    });
  }

  it('refuses a launch on Opus or Fable through the registered hooks, allows Sonnet', async () => {
    const o = await run({ settingSources: ['user'], model: 'claude-sonnet-5-5', effort: 'medium' });
    const verdicts = async (m: string) =>
      (await Promise.all(hookOf(o).map((h: any) => h(launch(m))))).map((r: any) => r?.hookSpecificOutput?.permissionDecision);
    expect(await verdicts('claude-opus-5-5')).toContain('deny');
    expect(await verdicts('fable')).toContain('deny');
    expect(await verdicts('claude-sonnet-5-5')).not.toContain('deny');
  });

  it('no coder effort selected: nothing forces the user\'s own preference', async () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'low';
    const o = await run({ settingSources: ['user'] });
    expect(o.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('low'); // ambient, untouched
    expect(o.settings).toBeUndefined();
  });

  it('a non-coder run is not pinned', async () => {
    const o = await run({ model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(o.settings).toBeUndefined();
    expect(o.env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
  });
});
