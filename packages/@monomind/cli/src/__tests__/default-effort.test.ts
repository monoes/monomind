// A role session runs at medium effort by default on the claude and codex
// runtimes. A cost tier overrides it; a role the org exempted from tiering
// stays untiered.

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../orgrt/bus.js';
import { defaultRoleEffort, isRoleExempt } from '../orgrt/cost-tier.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { runAgentSession } from '../orgrt/session.js';
import type { OrgDef, OrgRole } from '../orgrt/types.js';
import { mkdtempSync } from './tmp-track.js';

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

async function captureQueryOptions(opts: {
  role: OrgRole;
  def?: OrgDef;
}): Promise<Record<string, any>> {
  const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'default-effort-')));
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
  await runAgentSession({
    org: 'o',
    role: opts.role,
    def: opts.def,
    bus,
    policy: new PolicyEngine(opts.role.id, {}, bus, '/work'),
    mailbox,
    cwd: '/work',
    deliver: async () => 'delivered',
    queryFn: fakeQuery as any,
  });
  return seen;
}

describe('defaultRoleEffort', () => {
  it('is medium for the claude and codex runtimes and nothing elsewhere', () => {
    expect(defaultRoleEffort('claude')).toBe('medium');
    expect(defaultRoleEffort('codex')).toBe('medium');
    for (const r of ['antigravity', 'kimicode', 'opencode', 'vercel', 'nope', undefined]) {
      expect(defaultRoleEffort(r), String(r)).toBeUndefined();
    }
  });
});

describe('isRoleExempt', () => {
  it('is true only for a role the org assigned the exempt tier', () => {
    const exempt = def({ cost_tiers: { default: 'economy', roles: { coder: 'exempt' } } } as any);
    expect(isRoleExempt(exempt, 'coder')).toBe(true);
    expect(isRoleExempt(exempt, 'other')).toBe(false);
    expect(isRoleExempt(def(), 'coder')).toBe(false);
    expect(isRoleExempt(undefined, 'coder')).toBe(false);
  });
});

describe('session effort', () => {
  it('runs a claude role with no cost tier at medium effort', async () => {
    expect((await captureQueryOptions({ role: role() })).effort).toBe('medium');
    expect((await captureQueryOptions({ role: role(), def: def() })).effort).toBe('medium');
  });

  it("a cost tier's effort wins over the default", async () => {
    const high = def({ cost_tiers: { default: 'standard' } } as any);
    expect((await captureQueryOptions({ role: role(), def: high })).effort).toBe('high');
    const low = def({ cost_tiers: { default: 'budget' } } as any);
    expect((await captureQueryOptions({ role: role(), def: low })).effort).toBe('low');
  });

  it('a role exempted from tiering gets no effort at all', async () => {
    const exempt = def({ cost_tiers: { default: 'economy', roles: { coder: 'exempt' } } } as any);
    expect((await captureQueryOptions({ role: role(), def: exempt })).effort).toBeUndefined();
  });
});
