import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveOrgDefBlueprints } from '../../src/catalog/blueprints.js';
import { type OrgDef, OrgDefSchema, type OrgRole } from '../../src/orgrt/types.js';
import { newRoot, writeEntry } from './fixtures.js';

const blueprintFiles = (bp: Record<string, unknown>): Record<string, string> => ({
  'blueprint.json': JSON.stringify(bp),
  'LICENSE.txt': 'MIT License',
});

function seeded(): string {
  const root = newRoot();
  writeEntry(root, { name: 'verifier', kind: 'archetype' });
  writeEntry(root, { name: 'security-audit' });
  writeEntry(root, {
    name: 'security-reviewer',
    kind: 'blueprint',
    files: blueprintFiles({
      name: 'security-reviewer',
      description: 'Reviews for security',
      archetype: 'verifier',
      skills: ['security-audit'],
      skill_pool: ['tag:code-review'],
      runtimeHints: { reasoning: 'high' },
      recommendedPolicy: { git: 'read' },
    }),
  });
  writeEntry(root, {
    name: 'claude-only',
    kind: 'blueprint',
    targets: ['platform:claude'],
    files: blueprintFiles({ name: 'claude-only', description: 'x', skills: ['security-audit'] }),
  });
  writeEntry(root, {
    name: 'parked',
    kind: 'blueprint',
    status: 'disabled',
    files: blueprintFiles({ name: 'parked', description: 'x', skills: ['security-audit'] }),
  });
  return root;
}

const defWith = (role: Partial<OrgRole>): OrgDef =>
  OrgDefSchema.parse({ name: 'o', goal: 'g', roles: [{ id: 'r', reports_to: null, ...role }] });

describe('resolveOrgDefBlueprints', () => {
  const root = seeded();
  const r = (role: Partial<OrgRole>) => resolveOrgDefBlueprints(defWith(role), root).def.roles[0];

  it('fills unset skills and skill_pool from the blueprint, archetype first', () => {
    expect(r({ blueprint: 'security-reviewer' }).skills).toEqual(['verifier', 'security-audit']);
    expect(r({ blueprint: 'security-reviewer' }).skill_pool).toEqual(['tag:code-review']);
  });

  it('lets explicit role fields win, including an explicit empty list', () => {
    expect(r({ blueprint: 'security-reviewer', skills: ['custom'] }).skills).toEqual(['custom']);
    expect(r({ blueprint: 'security-reviewer', skills: [] }).skills).toEqual([]);
    expect(r({ blueprint: 'security-reviewer', skill_pool: [] }).skill_pool).toEqual([]);
  });

  it('never produces policy or tool_providers; hints and policy advice are notes only', () => {
    // Explicit policy passes through untouched (schema defaults included).
    const explicit = { blueprint: 'security-reviewer', policy: { git: 'read' } } as const;
    expect(r(explicit).policy).toEqual(defWith(explicit).roles[0].policy);
    expect(r(explicit).policy).toMatchObject({ git: 'read' });
    const res = resolveOrgDefBlueprints(defWith({ blueprint: 'security-reviewer' }), root);
    expect(res.def.roles[0].policy).toBeUndefined();
    expect(res.def.roles[0].tool_providers).toBeUndefined();
    expect(res.errors).toEqual([]);
    expect(res.notes).toContainEqual(expect.stringMatching(/reasoning.*high/));
    expect(res.notes).toContainEqual(expect.stringMatching(/git.*read/));
  });

  it('reports a blueprint that is missing, not targeted at org, or not active', () => {
    for (const name of ['missing', 'claude-only', 'parked']) {
      const res = resolveOrgDefBlueprints(defWith({ blueprint: name }), root);
      expect(res.errors).toContainEqual(
        expect.stringMatching(
          new RegExp(`blueprint "${name}" is not active for org on this machine`),
        ),
      );
      expect(res.def.roles[0].skills).toBeUndefined();
    }
  });

  it('does not mutate the input def', () => {
    const def = defWith({ blueprint: 'security-reviewer' });
    const before = JSON.stringify(def);
    resolveOrgDefBlueprints(def, root);
    expect(JSON.stringify(def)).toBe(before);
  });

  it('returns the same object when no role uses a blueprint, and creates no catalog files', () => {
    const defWithout = defWith({ skills: ['x'] });
    const res = resolveOrgDefBlueprints(defWithout, root);
    expect(res.def).toBe(defWithout);
    expect(res).toMatchObject({ errors: [], notes: [] });
    const bare = newRoot();
    expect(resolveOrgDefBlueprints(defWithout, bare).def).toBe(defWithout);
    expect(existsSync(join(bare, '.monomind'))).toBe(false);
  });

  it('rejects a blueprint field that is not a catalog name at parse time', () => {
    expect(() => defWith({ blueprint: '../evil' })).toThrow();
  });

  it('re-verifies the blueprint package instead of trusting a warm snapshot', () => {
    const root = newRoot();
    writeEntry(root, { name: 'sec', kind: 'blueprint', files: blueprintFiles({ name: 'sec', description: 'x', skills: ['a'] }) });
    const def = defWith({ blueprint: 'sec' });
    expect(resolveOrgDefBlueprints(def, root).def.roles[0].skills).toEqual(['a']);
    const file = readdirSync(join(root, '.monomind', 'catalog', 'packages', 'sec'))[0];
    writeFileSync(
      join(root, '.monomind', 'catalog', 'packages', 'sec', file, 'blueprint.json'),
      JSON.stringify({ name: 'sec', description: 'x', skills: ['evil'] }),
    );
    const res = resolveOrgDefBlueprints(def, root);
    expect(res.def.roles[0].skills).toBeUndefined();
    expect(res.errors.join()).toMatch(/digest-mismatch/);
  });
});
