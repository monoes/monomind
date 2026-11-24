// #835 PR 5: isSessionlessRole is a behaviour-preserving generalisation of the endpoint check.
// These tests pin the endpoint behaviour at each call site and guard against new literal sites.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  SESSIONLESS_ROLE_KINDS,
  isSessionlessRole,
} from '../../src/orgrt/sessionless-roles.js';
import { agentRoles, isEndpointRole } from '../../src/orgrt/endpoint-roles.js';
import { computeReplacementBudget } from '../../src/orgrt/role-slot.js';
import { isAgentRole } from '../../src/orgrt/documents/section-budget.js';
import { validateCostTiers } from '../../src/orgrt/cost-tier.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

const SRC = join(__dirname, '..', '..', 'src');

describe('isSessionlessRole', () => {
  it('is the endpoint or decision kind', () => {
    for (const r of [{ kind: 'endpoint' }, { kind: 'agent' }, {}, undefined, null, 'x', { kind: 1 }]) {
      expect(isSessionlessRole(r)).toBe(isEndpointRole(r));
    }
    expect(isSessionlessRole({ kind: 'decision' })).toBe(true);
    expect(isSessionlessRole({ kind: 'endpoint' })).toBe(true);
    expect(isSessionlessRole({ kind: 'agent' })).toBe(false);
  });

  it('agentRoles keeps exactly the non-sessionless roles, in order', () => {
    const roles = [{ id: 'a' }, { id: 'e', kind: 'endpoint' }, { id: 'b', kind: 'agent' }];
    expect(agentRoles(roles).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('endpoint behaviour pinned at refactored sites', () => {
  const def = (roles: unknown[]) =>
    ({ name: 'x', run_config: { budget_tokens: 900 }, roles }) as never;

  it('role-slot: endpoint roles take no share of the token budget', () => {
    const d = def([
      { id: 'boss', reports_to: null },
      { id: 'w', reports_to: 'boss' },
      { id: 'hook', reports_to: 'boss', kind: 'endpoint' },
    ]);
    expect(computeReplacementBudget(d, 'w')).toBe(450);
  });

  it('section-budget: isAgentRole is false only for endpoint roles', () => {
    expect(isAgentRole({ id: 'a', kind: 'endpoint' } as never)).toBe(false);
    expect(isAgentRole({ id: 'a' } as never)).toBe(true);
    expect(isAgentRole({ id: 'a', kind: 'agent' } as never)).toBe(true);
  });

  it('cost-tier: an endpoint role is not resolved against the tier catalog', () => {
    const parsed = OrgDefSchema.parse({
      name: 'x',
      cost_tiers: { roles: { hook: 'nope' } },
      roles: [
        { id: 'boss' },
        { id: 'hook', reports_to: 'boss', kind: 'endpoint', endpoint: { url: 'http://h/x' } },
      ],
    });
    const errors = validateCostTiers(parsed);
    expect(errors.some((e) => e.includes('role "hook"'))).toBe(false);
  });
});

/** Files that may spell the endpoint kind literally: the predicates themselves, "is an HTTP endpoint" sites, labels. */
const ALLOW = new Set([
  'orgrt/endpoint-roles.ts',
  'orgrt/decision-roles.ts',
  'orgrt/types-role.ts', // the schema's own kind/block cross-checks (a leaf: imports no runtime predicate)
  'orgrt/sessionless-roles.ts',
  'commands/org-observe-shared.ts', // endpoint-specific: reply tracking / role tables
  'orgrt/documents/writer-overlay.ts', // inert writer core: may import nothing new (writer-inert test)
  'orgrt/documents/section-budget.ts', // inert section-budget core: imports only itself (section-budget-inert test)
  'ui/org-config-patch.mjs', // plain .mjs cannot import the TS predicate
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|mjs)$/.test(n) ? [p] : [];
  });
}

describe('no new literal endpoint/decision-kind checks', () => {
  it('src uses the predicates outside the allow-list', () => {
    const re = /kind\s*[!=]==?\s*'(endpoint|decision)'/;
    const hits = walk(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !ALLOW.has(f))
      .filter((f) => re.test(readFileSync(join(SRC, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the .mjs UI list mirrors the TS sessionless kinds', () => {
    const src = readFileSync(join(SRC, 'ui/org-config-patch.mjs'), 'utf8');
    const m = /const SESSIONLESS_KINDS = \[([^\]]*)\]/.exec(src);
    expect(m).not.toBeNull();
    const kinds = m![1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect(kinds).toEqual([...SESSIONLESS_ROLE_KINDS]);
  });
});
