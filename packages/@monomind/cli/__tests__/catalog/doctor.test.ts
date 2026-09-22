import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagesDir } from '../../src/catalog/digest.js';
import { disable } from '../../src/catalog/lifecycle.js';
import { applyProjection } from '../../src/catalog/projection.js';
import { checkCatalog } from '../../src/commands/doctor-catalog-checks.js';
import { NOW, newRoot, tamper, writeEntry } from './fixtures.js';

const LATER = Date.parse(NOW) + 86_400_000;

describe('checkCatalog', () => {
  it('passes as "not configured" without state and creates nothing', async () => {
    const root = newRoot();
    const r = await checkCatalog(root);
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/not configured/i);
    expect(existsSync(join(root, '.monomind'))).toBe(false);
  });

  it('passes with only staged, approved and disabled entries', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'one', status: 'staged' });
    writeEntry(root, { name: 'two', status: 'approved' });
    writeEntry(root, { name: 'three', status: 'disabled' });
    expect((await checkCatalog(root, LATER)).status).toBe('pass');
  });

  it('passes a healthy active entry', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'fine', targets: ['org'] });
    const r = await checkCatalog(root, LATER);
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/1 active/);
  });

  it('fails an active digest mismatch and names the disable command', async () => {
    const root = newRoot();
    tamper(writeEntry(root, { name: 'bad', targets: ['org'] }));
    const r = await checkCatalog(root, LATER);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('skill:bad');
    expect(r.message).toContain('digest-mismatch');
    expect(r.fix).toContain('monomind catalog disable skill:bad');
  });

  it('fails an active entry whose package is missing', async () => {
    const root = newRoot();
    const e = writeEntry(root, { name: 'gone', targets: ['org'] });
    rmSync(e.dir, { recursive: true });
    const r = await checkCatalog(root, LATER);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('missing-package');
  });

  it('fails an active entry whose package path escapes the store', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'esc', targets: ['org'] });
    const outside = newRoot('cat-outside-');
    renameSync(join(packagesDir(root), 'esc'), join(outside, 'esc'));
    symlinkSync(join(outside, 'esc'), join(packagesDir(root), 'esc'));
    const r = await checkCatalog(root, LATER);
    expect(r.status).toBe('fail');
    expect(r.message).toContain('escaping-path');
  });

  it('fails an invalid state file', async () => {
    const root = newRoot();
    mkdirSync(join(root, '.monomind', 'catalog'), { recursive: true });
    writeFileSync(join(root, '.monomind', 'catalog', 'state.json'), '{ nope');
    expect((await checkCatalog(root, LATER)).status).toBe('fail');
  });

  it('ignores problems of entries that are not active', async () => {
    const root = newRoot();
    tamper(writeEntry(root, { name: 'idle', status: 'disabled' }));
    expect((await checkCatalog(root, LATER)).status).toBe('pass');
  });

  it('warns on an active legacy collision without replacesLegacy', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'dup', targets: ['org'] });
    mkdirSync(join(root, '.monomind', 'org-skills', 'dup'), { recursive: true });
    writeFileSync(
      join(root, '.monomind', 'org-skills', 'dup', 'SKILL.md'),
      '---\nname: dup\ndescription: legacy\n---\n',
    );
    const r = await checkCatalog(root, LATER);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('skill:dup');
    expect(r.message).toMatch(/legacy/);
  });

  it('does not warn on a collision the entry replaces', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'dup', targets: ['org'], replacesLegacy: true });
    mkdirSync(join(root, '.monomind', 'org-skills', 'dup'), { recursive: true });
    writeFileSync(
      join(root, '.monomind', 'org-skills', 'dup', 'SKILL.md'),
      '---\nname: dup\ndescription: legacy\n---\n',
    );
    expect((await checkCatalog(root, LATER)).status).toBe('pass');
  });

  it('warns on staged or quarantined entries older than 30 days only', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'old', status: 'staged' });
    writeEntry(root, { name: 'held', status: 'approved' });
    const at = Date.parse(NOW) + 31 * 86_400_000;
    const r = await checkCatalog(root, at);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('skill:old');
    expect(r.message).not.toContain('skill:held');
    expect((await checkCatalog(root, LATER)).status).toBe('pass');
  });

  it('warns on a projected copy whose entry is no longer eligible', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'proj', targets: ['platform:claude'] });
    await applyProjection(root, 'platform:claude', { dryRun: false });
    expect((await checkCatalog(root, LATER)).status).toBe('pass');
    disable(root, 'skill:proj', { actor: 'test' });
    const before = readFileSync(join(root, '.claude', 'skills', 'proj', 'SKILL.md'), 'utf8');
    const r = await checkCatalog(root, LATER);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('skill:proj');
    expect(r.fix).toContain('monomind catalog project --surface platform:claude --apply');
    expect(readFileSync(join(root, '.claude', 'skills', 'proj', 'SKILL.md'), 'utf8')).toBe(before);
  });

  it('warns on frontmatter drift in a projected copy', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'drift', targets: ['platform:agents'] });
    await applyProjection(root, 'platform:agents', { dryRun: false });
    const file = join(root, '.agents', 'skills', 'drift', 'SKILL.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('drift skill', 'edited by hand'));
    const r = await checkCatalog(root, LATER);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('frontmatter-drift');
  });
});
