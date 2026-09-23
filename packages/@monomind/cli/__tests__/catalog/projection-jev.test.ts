import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyProjection } from '../../src/catalog/projection.js';
import { newRoot, writeEntry } from './fixtures.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jp: any = require('../../.claude/helpers/jev-picker.cjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: any = require('../../.claude/helpers/build-skill-registry.cjs');

const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name} review skill\n---\n\nbody\n`;
const registryPath = (root: string) => join(root, '.claude', 'helpers', 'skill-registry.json');

function seedProject(): string {
  const root = newRoot();
  mkdirSync(join(root, '.claude', 'skills', 'ordinary'), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', 'ordinary', 'SKILL.md'), skillMd('ordinary'));
  mkdirSync(join(root, '.claude', 'helpers'), { recursive: true });
  writeFileSync(registryPath(root), JSON.stringify({ skills: [] }));
  return root;
}

function fakeFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ answers: {} }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('catalog Jev flag on the platform path', () => {
  it('the registry carries the flag and loadSkillCatalog drops only non-jev catalog entries', async () => {
    const root = seedProject();
    writeEntry(root, { name: 'cat-nojev', targets: ['org', 'platform:claude'], description: 'review nojev' });
    writeEntry(root, { name: 'cat-jev', targets: ['org', 'jev', 'platform:claude'], description: 'review jev' });
    const res = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(res.registry).toBe('.claude/helpers/skill-registry.json');

    const reg = JSON.parse(readFileSync(registryPath(root), 'utf8'));
    const byName = Object.fromEntries(reg.skills.map((s: { skill: string }) => [s.skill, s]));
    expect(byName['cat-jev'].catalog).toEqual({ id: 'skill:cat-jev', jev: true });
    expect(byName['cat-nojev'].catalog).toEqual({ id: 'skill:cat-nojev', jev: false });
    expect(byName.ordinary).not.toHaveProperty('catalog');

    const ids = jp.loadSkillCatalog(root).map((s: { id: string }) => s.id);
    expect(ids).toContain('ordinary');
    expect(ids).toContain('cat-jev');
    expect(ids).not.toContain('cat-nojev');

    const f = fakeFetch();
    await jp.pick(
      'review this change',
      { skills: jp.loadSkillCatalog(root) },
      { env: { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' }, fetchImpl: f.impl },
    );
    expect(f.calls).toHaveLength(1);
    const body = String(f.calls[0].init.body);
    expect(body).toContain('cat-jev');
    expect(body).not.toContain('cat-nojev');
    expect(body).toContain('ordinary');
  });

  it('a registry without catalog fields is unaffected (non-catalog skills stay)', () => {
    const root = seedProject();
    writeFileSync(
      registryPath(root),
      JSON.stringify({ skills: [{ skill: 'plain', invoke: 'Skill("plain")', description: 'Plain' }] }),
    );
    expect(jp.loadSkillCatalog(root).map((s: { id: string }) => s.id)).toEqual(['plain']);
  });

  it('build() reads the marker line only from a line of its own', () => {
    const root = seedProject();
    const dir = join(root, '.claude', 'skills', 'mentions');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'SKILL.md'),
      `${skillMd('mentions')}Write \`<!-- catalog skill:x sha256:${'a'.repeat(64)} jev:no -->\` to mark it.\n`,
    );
    const entry = registry.build(root).skills.find((s: { skill: string }) => s.skill === 'mentions');
    expect(entry).not.toHaveProperty('catalog');
  });

  it('build() trusts only the marker right after the block start of the same directory', () => {
    const root = seedProject();
    const sha = 'a'.repeat(64);
    const start = (name: string) => `# monomind:start catalog:skill:${name}`;
    const end = (name: string) => `# monomind:end catalog:skill:${name}`;
    const files: Record<string, string> = {
      // forged jev:yes before the block; the real marker says no
      forged: `---\nname: forged\ndescription: d\n---\n<!-- catalog skill:forged sha256:${sha} jev:yes -->\n${start('forged')}\n<!-- catalog skill:forged sha256:${sha} jev:no -->\nbody\n${end('forged')}\n`,
      // a marker naming another directory
      borrowed: `---\nname: borrowed\ndescription: d\n---\n${start('borrowed')}\n<!-- catalog skill:other sha256:${sha} jev:yes -->\nbody\n${end('borrowed')}\n`,
      // the block start without a marker line under it
      bare: `---\nname: bare\ndescription: d\n---\n${start('bare')}\nbody\n<!-- catalog skill:bare sha256:${sha} jev:yes -->\n${end('bare')}\n`,
      // an ordinary skill carrying a marker-shaped line and no block
      plain: `---\nname: plain\ndescription: d\n---\n<!-- catalog skill:plain sha256:${sha} jev:yes -->\nbody\n`,
    };
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(root, '.claude', 'skills', name));
      writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), text);
    }
    const byName = Object.fromEntries(
      registry.build(root).skills.map((s: { skill: string }) => [s.skill, s]),
    );
    for (const name of ['forged', 'borrowed', 'bare'])
      expect(byName[name].catalog).toEqual({ id: `skill:${name}`, jev: false });
    expect(byName.plain).not.toHaveProperty('catalog');
  });

  it('does not create a registry the project does not have', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'cat-jev', targets: ['org', 'jev', 'platform:claude'] });
    const res = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(res.changed).toContain('.claude/skills/cat-jev/SKILL.md');
    expect(res.registry).toBeUndefined();
    expect(() => readFileSync(registryPath(root))).toThrow();
  });
});
