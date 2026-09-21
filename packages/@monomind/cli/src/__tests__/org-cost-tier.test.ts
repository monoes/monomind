// packages/@monomind/cli/src/__tests__/org-cost-tier.test.ts
//
// ADR-O001 D8 — provider-agnostic cost tiers (model AND reasoning effort).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../orgrt/bus.js';
import {
  BUILTIN_COST_TIERS,
  CostTierError,
  EXEMPT_TIER,
  resolveRoleCostTier,
  validateCostTiers,
} from '../orgrt/cost-tier.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { runAgentSession } from '../orgrt/session.js';
import { type OrgDef, OrgDefSchema, type OrgRole } from '../orgrt/types.js';
import { DEFAULT_CLAUDE_MODEL } from '../orgrt/vercel-providers.js';

const dir = () => mkdtempSync(join(tmpdir(), 'cost-tier-'));

const role = (over: Partial<OrgRole> = {}): OrgRole =>
  ({
    id: 'coder',
    title: 'Coder',
    type: 'specialist',
    reports_to: 'boss',
    responsibilities: [],
    ...over,
  }) as OrgRole;

const def = (over: Partial<OrgDef> = {}): OrgDef =>
  ({ name: 'o', goal: '', roles: [role()], ...over }) as OrgDef;

/** Runs one session against a fake SDK and returns the options query() saw. */
async function captureQueryOptions(opts: {
  role: OrgRole;
  def?: OrgDef;
}): Promise<Record<string, any>> {
  const bus = new OrgBus('o', 'r', dir());
  const mailbox = new Mailbox();
  mailbox.push('go');
  mailbox.close();
  let seen: Record<string, any> = {};
  const fakeQuery = ({ prompt, options }: any) =>
    (async function* () {
      seen = options;
      for await (const _ of prompt) break;
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  const policy = new PolicyEngine(opts.role.id, {}, bus, '/work');
  await runAgentSession({
    org: 'o',
    role: opts.role,
    def: opts.def,
    bus,
    policy,
    mailbox,
    cwd: '/work',
    deliver: async () => 'delivered',
    queryFn: fakeQuery as any,
  });
  return seen;
}

describe('D8 cost tiers — upgrade safety (defaulted off)', () => {
  it('resolves to nothing when the org declares no cost_tiers', () => {
    expect(resolveRoleCostTier({ role: role(), def: def() })).toBeUndefined();
  });

  it('resolves to nothing when cost_tiers exists but names no default and no role', () => {
    expect(
      resolveRoleCostTier({
        role: role(),
        def: def({ cost_tiers: { tiers: { silly: { claude: { model: 'x' } } } } } as any),
      }),
    ).toBeUndefined();
  });

  it('leaves an untiered session byte-identical: default model, no effort, no extra env', async () => {
    const baseEnvKeys = Object.keys((await captureQueryOptions({ role: role() })).env).sort();
    const seen = await captureQueryOptions({ role: role(), def: def() });
    expect(seen.model).toBe(DEFAULT_CLAUDE_MODEL);
    expect(seen.effort).toBeUndefined();
    expect(seen.thinking).toBeUndefined();
    expect(Object.keys(seen.env).sort()).toEqual(baseEnvKeys);
  });

  it('reports no validation errors for an org without cost_tiers', () => {
    expect(validateCostTiers(def())).toEqual([]);
  });
});

describe('D8 cost tiers — resolution and precedence', () => {
  it('applies the org default tier to every role (built-in Claude catalog)', () => {
    const r = resolveRoleCostTier({
      role: role(),
      def: def({ cost_tiers: { default: 'economy' } } as any),
    });
    expect(r).toMatchObject({
      tier: 'economy',
      provider: 'claude',
      model: BUILTIN_COST_TIERS.economy.claude.model,
      effort: BUILTIN_COST_TIERS.economy.claude.effort,
    });
  });

  it('an explicit adapter_config.model beats the tier, but the tier still sets effort', () => {
    const r = resolveRoleCostTier({
      role: role({ adapter_config: { model: 'pinned-x' } } as any),
      def: def({ cost_tiers: { default: 'budget' } } as any),
    });
    // the resolver reports what the tier says; session.ts applies the precedence
    expect(r?.model).toBe(BUILTIN_COST_TIERS.budget.claude.model);
    expect(r?.effort).toBe('low');
  });

  it('a per-role tier overrides the org default', () => {
    const r = resolveRoleCostTier({
      role: role({ id: 'reviewer' }),
      def: def({
        cost_tiers: { default: 'budget', roles: { reviewer: 'standard' } },
      } as any),
    });
    expect(r?.tier).toBe('standard');
    expect(r?.model).toBe(BUILTIN_COST_TIERS.standard.claude.model);
  });

  it('a per-role effort drops effort without changing the model (patrol roles)', () => {
    const r = resolveRoleCostTier({
      role: role({ id: 'patrol' }),
      def: def({
        cost_tiers: { default: 'economy', roles: { patrol: { tier: 'economy', effort: 'low' } } },
      } as any),
    });
    expect(r?.model).toBe(BUILTIN_COST_TIERS.economy.claude.model);
    expect(r?.effort).toBe('low');
  });

  it('a role marked exempt is never tiered — the deliberative escape hatch', () => {
    const r = resolveRoleCostTier({
      role: role({ id: 'architect' }),
      def: def({
        cost_tiers: { default: 'budget', roles: { architect: EXEMPT_TIER } },
      } as any),
    });
    expect(r).toBeUndefined();
  });
});

describe('D8 cost tiers — provider agnosticism', () => {
  it('keys off the vercel vendor when the role has one', () => {
    const r = resolveRoleCostTier({
      role: role({ runtime: 'vercel', provider: { kind: 'vercel-api-key', vendor: 'glm' } } as any),
      def: def({
        cost_tiers: {
          default: 'economy',
          tiers: { economy: { glm: { model: 'glm-5.2-air', effort: 'medium' } } },
        },
      } as any),
    });
    expect(r).toMatchObject({ provider: 'glm', model: 'glm-5.2-air', effort: 'medium' });
  });

  it('keys off the role runtime for CLI runners', () => {
    const r = resolveRoleCostTier({
      role: role({ runtime: 'codex' }),
      def: def({
        cost_tiers: {
          default: 'economy',
          tiers: { economy: { codex: { model: 'gpt-5.6-mini', effort: 'medium' } } },
        },
      } as any),
    });
    expect(r).toMatchObject({ provider: 'codex', model: 'gpt-5.6-mini' });
  });

  it('accepts a provider key the code has never heard of, with no code change', () => {
    const r = resolveRoleCostTier({
      role: role({
        runtime: 'vercel',
        provider: { kind: 'vercel-api-key', vendor: 'acme' },
      } as any),
      def: def({
        cost_tiers: {
          default: 'thrift',
          tiers: { thrift: { acme: { model: 'acme-tiny', effort: 'low' } } },
          providers: { acme: { effort_env: { low: { ACME_REASONING: 'brief' } } } },
        },
      } as any),
    });
    expect(r).toMatchObject({ provider: 'acme', model: 'acme-tiny', effort: 'low' });
    expect(r?.env).toEqual({ ACME_REASONING: 'brief' });
  });

  it('a user tier entry extends the built-in catalog rather than replacing it', () => {
    const cfg = {
      cost_tiers: {
        default: 'economy',
        tiers: { economy: { codex: { model: 'gpt-5.6-mini' } } },
      },
    } as any;
    expect(resolveRoleCostTier({ role: role({ runtime: 'codex' }), def: def(cfg) })?.model).toBe(
      'gpt-5.6-mini',
    );
    // claude entry from the built-in catalog is still there
    expect(resolveRoleCostTier({ role: role(), def: def(cfg) })?.model).toBe(
      BUILTIN_COST_TIERS.economy.claude.model,
    );
  });
});

describe('D8 cost tiers — fail loudly, never silently downgrade', () => {
  it('throws when the tier has no entry for the role provider', () => {
    expect(() =>
      resolveRoleCostTier({
        role: role({ runtime: 'crush' }),
        def: def({ cost_tiers: { default: 'economy' } } as any),
      }),
    ).toThrow(CostTierError);
  });

  it('validate reports the unresolvable role/provider pair by name', () => {
    const errs = validateCostTiers(
      def({
        roles: [role({ id: 'worker', runtime: 'crush' })],
        cost_tiers: { default: 'economy' },
      } as any),
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('worker');
    expect(errs[0]).toContain('crush');
    expect(errs[0]).toContain('economy');
  });

  it('validate reports an unknown tier name', () => {
    const errs = validateCostTiers(def({ cost_tiers: { default: 'platinum' } } as any));
    expect(errs.join(' ')).toContain('platinum');
  });

  it('validate reports an unknown tier named on a role', () => {
    const errs = validateCostTiers(def({ cost_tiers: { roles: { coder: 'platinum' } } } as any));
    expect(errs.join(' ')).toContain('platinum');
  });
});

describe('D8 cost tiers — config surface', () => {
  it('OrgDefSchema accepts a full cost_tiers block and preserves it verbatim', () => {
    const raw = {
      name: 'growth',
      goal: 'ship',
      cost_tiers: {
        default: 'economy',
        roles: {
          patrol: { tier: 'budget', effort: 'off' },
          reviewer: 'standard',
          architect: 'exempt',
        },
        tiers: {
          economy: { codex: { model: 'gpt-5.6-mini', effort: 'medium' } },
          thrift: { acme: { model: 'acme-tiny', effort: 'low' } },
        },
        providers: { acme: { effort_env: { low: { ACME_REASONING: 'brief' } } } },
      },
      roles: [{ id: 'coder' }],
    };
    const parsed = OrgDefSchema.parse(raw);
    expect(parsed.cost_tiers).toEqual(raw.cost_tiers);
  });

  it('OrgDefSchema rejects an effort level outside the abstract vocabulary', () => {
    expect(() =>
      OrgDefSchema.parse({
        name: 'growth',
        cost_tiers: { tiers: { economy: { claude: { model: 'x', effort: 'ludicrous' } } } },
        roles: [{ id: 'coder' }],
      }),
    ).toThrow();
  });
});

describe('D8 cost tiers — session wiring', () => {
  it('a tiered Claude role runs on the tier model at the tier effort', async () => {
    const seen = await captureQueryOptions({
      role: role(),
      def: def({ cost_tiers: { default: 'budget' } } as any),
    });
    expect(seen.model).toBe(BUILTIN_COST_TIERS.budget.claude.model);
    expect(seen.effort).toBe('low');
  });

  it('an explicit role model still wins over the tier model', async () => {
    const seen = await captureQueryOptions({
      role: role({ adapter_config: { model: 'pinned-x' } } as any),
      def: def({ cost_tiers: { default: 'budget' } } as any),
    });
    expect(seen.model).toBe('pinned-x');
    expect(seen.effort).toBe('low');
  });

  it("effort 'off' disables extended thinking rather than passing a bogus effort", async () => {
    const seen = await captureQueryOptions({
      role: role(),
      def: def({
        cost_tiers: {
          default: 'economy',
          roles: { coder: { tier: 'economy', effort: 'off' } },
        },
      } as any),
    });
    expect(seen.effort).toBeUndefined();
    expect(seen.thinking).toEqual({ type: 'disabled' });
  });

  it('a provider effort_env reaches the runner env', async () => {
    const seen = await captureQueryOptions({
      role: role(),
      def: def({
        cost_tiers: {
          default: 'economy',
          providers: { claude: { effort_env: { medium: { SOME_PROVIDER_EFFORT: 'mid' } } } },
        },
      } as any),
    });
    expect(seen.env.SOME_PROVIDER_EFFORT).toBe('mid');
  });
});
