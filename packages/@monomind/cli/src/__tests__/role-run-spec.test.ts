// The dry run showed a model only for a role that pins one, so a role on a cost tier or the
// default looked unresolved. roleRunSpec resolves model, effort and runtime the way a live session does.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { latestModel } from '../latest-models.js';
import { OrgBus } from '../orgrt/bus.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { roleRunSpec } from '../orgrt/role-run-spec.js';
import { runAgentSession } from '../orgrt/session.js';
import { OrgDefSchema } from '../orgrt/types.js';
import { mkdtempSync } from './tmp-track.js';

const org = (cost_tiers?: Record<string, unknown>, role: Record<string, unknown> = {}) =>
  OrgDefSchema.parse({
    name: 'o',
    goal: 'g',
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null, responsibilities: [], ...role },
    ],
    ...(cost_tiers ? { cost_tiers } : {}),
  });

describe('roleRunSpec', () => {
  it('an unpinned claude role is the newest Sonnet at medium effort', () => {
    const def = org();
    expect(roleRunSpec(def, def.roles[0])).toEqual({
      runtime: 'claude',
      model: latestModel('claude', 'sonnet'),
      effort: 'medium',
    });
  });

  it('a tier supplies the model and its effort, an effort override wins, a pin beats the tier model', () => {
    const tier = org({ roles: { boss: { tier: 'standard', effort: 'high' } } });
    expect(roleRunSpec(tier, tier.roles[0])).toMatchObject({
      model: latestModel('claude', 'opus'),
      effort: 'high',
    });
    const pinned = org({ default: 'economy' }, { adapter_config: { model: 'claude-opus-5-5' } });
    expect(roleRunSpec(pinned, pinned.roles[0])).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'medium',
    });
  });

  it('a codex role is the newest Terra at medium; antigravity carries effort in the model id', () => {
    const codex = org(undefined, { runtime: 'codex', provider: { kind: 'codex' } });
    expect(roleRunSpec(codex, codex.roles[0])).toEqual({
      runtime: 'codex',
      model: latestModel('codex', 'terra'),
      effort: 'medium',
    });
    const agy = org(undefined, { runtime: 'antigravity', provider: { kind: 'antigravity' } });
    expect(roleRunSpec(agy, agy.roles[0])).toEqual({
      runtime: 'antigravity',
      model: latestModel('antigravity', 'flash-high'),
      effort: undefined,
    });
  });

  it('an exempt role has no effort', () => {
    const def = org({ default: 'economy', roles: { boss: 'exempt' } });
    expect(roleRunSpec(def, def.roles[0]).effort).toBeUndefined();
  });

  it('matches what a live session passes to the runner', async () => {
    for (const def of [
      org(),
      org({ roles: { boss: { tier: 'standard', effort: 'low' } } }),
      org({ default: 'budget' }),
      org({ roles: { boss: 'exempt' }, default: 'economy' }),
    ]) {
      const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'run-spec-')));
      const mailbox = new Mailbox();
      mailbox.push('go');
      mailbox.close();
      let seen: Record<string, any> = {};
      const queryFn = ({ prompt, options }: any) =>
        (async function* () {
          seen = options;
          for await (const _ of prompt) break;
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        })();
      await runAgentSession({
        org: 'o',
        role: def.roles[0],
        def,
        bus,
        policy: new PolicyEngine('boss', {}, bus, '/work'),
        mailbox,
        cwd: '/work',
        deliver: async () => 'delivered',
        queryFn: queryFn as any,
      });
      const spec = roleRunSpec(def, def.roles[0]);
      expect(seen.model).toBe(spec.model);
      expect(seen.effort).toBe(spec.effort);
    }
  });
});
