import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, catalogAudit, eligible } from '../../src/catalog/snapshot.js';
import { newRoot, tamper, writeEntry } from './fixtures.js';

function seeded(): string {
  const root = newRoot();
  writeEntry(root, { name: 'active-org', targets: ['org'], tags: ['api'], tools: ['monograph_query'] });
  writeEntry(root, { name: 'claude-only', targets: ['platform:claude'] });
  writeEntry(root, { name: 'staged-one', status: 'staged' });
  writeEntry(root, { name: 'disabled-one', status: 'disabled', targets: ['org'] });
  tamper(writeEntry(root, { name: 'tampered', targets: ['org'] }));
  return root;
}

describe('buildSnapshot', () => {
  it('yields verified, sorted, body-free assets and eligibility per target', () => {
    const root = seeded();
    const snap = buildSnapshot(root);
    expect(eligible(snap, 'org').map((a) => a.id)).toEqual(['skill:active-org']);
    expect(eligible(snap, 'platform:claude').map((a) => a.id)).toEqual(['skill:claude-only']);
    expect(snap.diagnostics).toContainEqual({ id: 'skill:tampered', reason: 'digest-mismatch' });
    expect(snap.assets.find((a) => a.id === 'skill:tampered')?.eligible).toBe(false);
    expect(snap.assets.find((a) => a.id === 'skill:tampered')?.dir).toBeUndefined();
    expect(JSON.stringify(snap)).not.toContain('BODY-SENTINEL');
    expect(snap.assets.map((a) => a.id)).toEqual([...snap.assets.map((a) => a.id)].sort());
    const a = snap.assets.find((x) => x.id === 'skill:active-org');
    expect(a).toMatchObject({
      name: 'active-org',
      description: 'active-org skill',
      tags: ['api'],
      requestedTools: ['monograph_query'],
      grantedTools: [],
      eligible: true,
    });
    expect(snap.stateVersion).toBe(1);
  });

  it('is empty and creates nothing without state', () => {
    const emptyRoot = newRoot();
    expect(buildSnapshot(emptyRoot)).toEqual({ assets: [], diagnostics: [], stateVersion: null });
    expect(existsSync(join(emptyRoot, '.monomind', 'catalog'))).toBe(false);
  });

  it('turns an unreadable state into one diagnostic instead of throwing', () => {
    const root = newRoot();
    mkdirSync(join(root, '.monomind', 'catalog'), { recursive: true });
    writeFileSync(join(root, '.monomind', 'catalog', 'state.json'), '{ nope');
    const snap = buildSnapshot(root);
    expect(snap.assets).toEqual([]);
    expect(snap.diagnostics).toHaveLength(1);
    expect(snap.diagnostics[0].id).toBe('(state)');
  });

  it('reads blueprint metadata from blueprint.json', () => {
    const root = newRoot();
    writeEntry(root, { name: 'reviewer', kind: 'blueprint', description: 'Reviews code' });
    const [bp] = buildSnapshot(root).assets;
    expect(bp).toMatchObject({ id: 'blueprint:reviewer', kind: 'blueprint', description: 'Reviews code' });
  });
});

describe('catalogAudit', () => {
  it('reports an unconfigured project as ok', () => {
    expect(catalogAudit(newRoot())).toMatchObject({ ok: true, configured: false, active: 0 });
  });

  it('flags active-entry problems, counts targets and lists legacy collisions', () => {
    const root = seeded();
    mkdirSync(join(root, '.monomind', 'org-skills', 'active-org'), { recursive: true });
    writeFileSync(
      join(root, '.monomind', 'org-skills', 'active-org', 'SKILL.md'),
      '---\nname: active-org\ndescription: legacy\n---\n',
    );
    const audit = catalogAudit(root);
    expect(audit.ok).toBe(false);
    expect(audit.configured).toBe(true);
    expect(audit.active).toBe(3);
    expect(audit.activeByTarget).toMatchObject({ org: 2, 'platform:claude': 1 });
    expect(audit.entries.find((e) => e.id === 'skill:tampered')?.problems).toContain(
      'digest-mismatch',
    );
    expect(audit.legacyCollisions).toContainEqual({
      name: 'active-org',
      legacyOrigin: 'project',
      catalogId: 'skill:active-org',
      replacesLegacy: false,
    });
  });

  it('re-hashes instead of trusting a warm snapshot cache', () => {
    const root = newRoot();
    const e = writeEntry(root, { name: 'fresh', targets: ['org'] });
    expect(eligible(buildSnapshot(root), 'org')).toHaveLength(1);
    tamper(e);
    expect(catalogAudit(root).ok).toBe(false);
  });

  it('does not serve a cached view after a same-size, same-mtime state rewrite', () => {
    const root = newRoot();
    writeEntry(root, { name: 'flip', targets: ['org'] });
    const file = join(root, '.monomind', 'catalog', 'state.json');
    utimesSync(file, 1_000_000, 1_000_000);
    expect(eligible(buildSnapshot(root), 'org')).toHaveLength(1);
    const { size } = statSync(file);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"status": "active"', '"status": "staged"'));
    utimesSync(file, 1_000_000, 1_000_000);
    expect(statSync(file)).toMatchObject({ size, mtimeMs: 1_000_000_000 });
    expect(buildSnapshot(root).assets[0].status).toBe('staged');
    expect(eligible(buildSnapshot(root), 'org')).toEqual([]);
  });
});
