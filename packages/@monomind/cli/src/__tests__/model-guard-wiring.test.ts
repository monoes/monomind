// Claude Fable and GPT Astra are never assigned or routed: every place that
// chooses, resolves, lists or validates a model refuses them.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentLifecycleTools } from '../mcp-tools/agent-tools-lifecycle.js';
import { determineAgentModel } from '../mcp-tools/agent-tools-store.js';
import { isBlockedModel, ModelBlockedError } from '../model-guard.js';
import { runAgentExecOnce } from '../orgrt/agent-exec.js';
import { listRuntimeModels } from '../orgrt/agent-models.js';
import { BUILTIN_COST_TIERS } from '../orgrt/cost-tier.js';
import { modelGuardPreToolUse } from '../orgrt/model-guard-hook.js';
import { validateOrgModels } from '../orgrt/org-model-guard.js';
import { resolveModel } from '../orgrt/session-prompt.js';
import { OrgDefSchema } from '../orgrt/types.js';
import { checklistFindings } from '../orgrt/validate-checklist.js';
import { DEFAULT_CLAUDE_MODEL, VERCEL_PROVIDERS } from '../orgrt/vercel-providers.js';

const role = (model?: string, extra: Record<string, unknown> = {}) => ({
  id: 'boss',
  title: 'Boss',
  type: 'boss',
  reports_to: null,
  responsibilities: ['lead the work'],
  ...(model ? { adapter_config: { model } } : {}),
  ...extra,
});
const orgOf = (roles: unknown[], extra: Record<string, unknown> = {}) =>
  OrgDefSchema.parse({ name: 't', goal: 'g', roles, ...extra });

describe('orgs: a blocked model is a validation error', () => {
  it('flags a role whose adapter_config.model is blocked, naming the role', () => {
    const errors = validateOrgModels(orgOf([role('claude-fable-5-1')]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('boss');
    expect(errors[0]).toContain('claude-fable-5-1');
  });

  it('flags a blocked model inside a cost tier, for any provider key', () => {
    const def = orgOf([role('claude-opus-5-5')], {
      cost_tiers: { tiers: { panel: { codex: { model: 'gpt-6-astra', effort: 'medium' } } } },
    });
    const errors = validateOrgModels(def);
    expect(errors.some((e) => e.includes('cost_tiers') && e.includes('gpt-6-astra'))).toBe(true);
  });

  it('passes an org that only names allowed models', () => {
    const def = orgOf(
      [
        role('claude-opus-5-5'),
        role('gpt-5.6-terra', { id: 'w', reports_to: 'boss', type: 'specialist' }),
      ],
      {
        cost_tiers: { tiers: { panel: { codex: { model: 'gpt-5.6-terra' } } } },
      },
    );
    expect(validateOrgModels(def)).toEqual([]);
  });

  it('is part of the shared checklist that validate, start, reload and the dashboard run', () => {
    const { errors } = checklistFindings(orgOf([role('claude-fable-5-1')]));
    expect(errors.some((e) => e.includes('claude-fable-5-1'))).toBe(true);
    expect(
      checklistFindings(orgOf([role('claude-opus-5-5')])).errors.some((e) => /blocked/i.test(e)),
    ).toBe(false);
  });
});

describe('resolveModel and the defaults', () => {
  it('refuses a blocked explicit model at session start', () => {
    const r = orgOf([role('claude-fable-5-1')]).roles[0];
    expect(() => resolveModel(r, 'claude')).toThrow(ModelBlockedError);
    const x = orgOf([role('gpt-6-astra')]).roles[0];
    expect(() => resolveModel(x, 'codex')).toThrow(ModelBlockedError);
  });

  it('no runtime, vendor or built-in tier default is a blocked model', () => {
    const bare = orgOf([role()]).roles[0];
    for (const runtime of [
      undefined,
      'claude',
      'kimicode',
      'opencode',
      'codex',
      'antigravity',
      'vercel',
    ]) {
      expect(isBlockedModel(resolveModel(bare, runtime)), String(runtime)).toBe(false);
    }
    for (const [vendor, p] of Object.entries(VERCEL_PROVIDERS)) {
      expect(isBlockedModel(p.defaultModel), vendor).toBe(false);
      expect(isBlockedModel(resolveModel(bare, 'vercel', vendor)), vendor).toBe(false);
    }
    expect(isBlockedModel(DEFAULT_CLAUDE_MODEL)).toBe(false);
    for (const tier of Object.values(BUILTIN_COST_TIERS)) {
      for (const entry of Object.values(tier)) expect(isBlockedModel(entry.model)).toBe(false);
    }
  });

  it('MCP agent routing never resolves to a blocked model, even when one is asked for', async () => {
    for (const type of ['coder', 'architect', 'Security Engineer', 'formatter', 'unknown-type']) {
      for (const asked of [undefined, 'fable', 'claude-fable-5-1', 'gpt-6-astra']) {
        const r = await determineAgentModel(type, asked ? { model: asked } : {});
        expect(isBlockedModel(r.model), `${type}/${asked}`).toBe(false);
      }
    }
  });
});

describe('model listings never offer a blocked model', () => {
  it('claude: drops entries whose value or resolved model is blocked', async () => {
    const r = await listRuntimeModels('claude', {
      listClaude: async () => [
        { value: 'default', resolvedModel: 'claude-sonnet-5-5', displayName: 'Default' },
        { value: 'fable', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1' },
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5' },
      ],
    });
    expect(r.models.map((m) => m.id)).toEqual(['default', 'opus']);
  });

  it('codex: drops the Astra entries', async () => {
    const r = await listRuntimeModels('codex', {
      env: { PATH: '', CODEX_CLI_BIN: process.execPath },
      runCli: async () =>
        JSON.stringify({
          models: [
            { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list' },
            { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list' },
          ],
        }),
    });
    expect(r.models.map((m) => m.id)).toEqual(['gpt-5.6-terra']);
  });
});

describe('agent exec and agent test', () => {
  it('refuse a blocked --model before any runner is built, with exit 2', async () => {
    for (const [runtime, model] of [
      ['claude', 'claude-fable-5-1'],
      ['claude', 'fable'],
      ['codex', 'gpt-6-astra'],
    ] as const) {
      const events: Array<Record<string, unknown>> = [];
      const code = await runAgentExecOnce({
        runtime,
        model,
        prompt: 'hi',
        emit: (e: Record<string, unknown>) => events.push(e),
      } as never);
      expect(code, model).toBe(2);
      expect(events.find((e) => e.type === 'error')).toMatchObject({
        code: 'unsafe',
        fatal: true,
        message: expect.stringMatching(/blocked/i),
      });
      expect(events.find((e) => e.type === 'done')).toMatchObject({ exit_code: 2 });
    }
  });
});

describe('subagent launches (Agent and Task tools)', () => {
  const hook = (tool: string, input: Record<string, unknown>) =>
    modelGuardPreToolUse({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });

  it('denies a launch that names a blocked model', async () => {
    for (const model of ['fable', 'claude-fable-5-1', 'gpt-6-astra']) {
      for (const tool of ['Agent', 'Task']) {
        const out = await hook(tool, { model, description: 'x' });
        expect((out.hookSpecificOutput as { permissionDecision: string }).permissionDecision).toBe(
          'deny',
        );
      }
    }
  });

  it('allows other models, no model, and other tools', async () => {
    expect(await hook('Agent', { model: 'opus' })).toEqual({});
    expect(await hook('Task', { model: 'claude-sonnet-5-5' })).toEqual({});
    expect(await hook('Agent', { description: 'no model' })).toEqual({});
    expect(await hook('Bash', { model: 'fable' })).toEqual({});
    expect(
      await modelGuardPreToolUse({
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_input: { model: 'fable' },
      }),
    ).toEqual({});
  });
});

describe('MCP agent_spawn', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'model-guard-spawn-'));
    process.env.MONOMIND_CWD = dir;
  });
  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a blocked model instead of recording it', async () => {
    const spawn = agentLifecycleTools.find((t) => t.name === 'agent_spawn')!;
    const bad = (await spawn.handler({ agentType: 'coder', model: 'claude-fable-5-1' })) as {
      success: boolean;
      error?: string;
    };
    expect(bad.success).toBe(false);
    expect(bad.error).toMatch(/blocked/i);
    const astra = (await spawn.handler({
      agentType: 'coder',
      config: { model: 'gpt-6-astra' },
    })) as {
      success: boolean;
    };
    expect(astra.success).toBe(false);
  });
});
