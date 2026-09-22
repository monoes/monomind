import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogAction } from '../../src/commands/catalog.js';
import { newRoot, writeEntry } from './fixtures.js';

function run(root: string, args: string[], flags: Record<string, unknown> = {}) {
  const out: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
    out.push(`${String(m)}\n`);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return catalogAction({ args, flags: { _: [], ...flags }, cwd: root, interactive: false }).then(
    (res) => ({ res, out: out.join('') }),
  );
}

describe('monomind catalog (read-only verbs)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('audit --format json on an empty project reports an unconfigured, ok catalog', async () => {
    const { res, out } = await run(newRoot(), ['audit'], { format: 'json' });
    expect(res.success).toBe(true);
    expect(JSON.parse(out)).toMatchObject({ ok: true, configured: false, active: 0 });
  });

  it('show of an unknown id exits 1', async () => {
    const { res } = await run(newRoot(), ['show', 'skill:nope']);
    expect(res).toMatchObject({ success: false, exitCode: 1 });
  });

  it('search --target returns only entries eligible for that target', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'api-review', targets: ['org'], description: 'Review an API' });
    writeEntry(root, { name: 'api-claude', targets: ['platform:claude'], description: 'API work' });
    writeEntry(root, { name: 'api-staged', status: 'staged', description: 'API staged' });
    const { res, out } = await run(root, ['search', 'api'], { target: 'org', format: 'json' });
    expect(res.success).toBe(true);
    expect(JSON.parse(out).assets.map((a: { id: string }) => a.id)).toEqual(['skill:api-review']);
  });

  it('list --target filters and show prints the entry', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'one', targets: ['org'] });
    writeEntry(root, { name: 'two', targets: ['platform:agents'] });
    const listed = await run(root, ['list'], { target: 'platform:agents', format: 'json' });
    expect(JSON.parse(listed.out).assets.map((a: { id: string }) => a.id)).toEqual(['skill:two']);
    vi.restoreAllMocks();
    const shown = await run(root, ['show', 'skill:one'], { format: 'json' });
    expect(JSON.parse(shown.out)).toMatchObject({ asset: { id: 'skill:one' }, entry: { status: 'active' } });
  });

  it('rejects an unknown target', async () => {
    const { res } = await run(newRoot(), ['list'], { target: 'platform:codex' });
    expect(res).toMatchObject({ success: false, exitCode: 1 });
  });
});

describe('monomind catalog (lifecycle verbs)', () => {
  afterEach(() => vi.restoreAllMocks());

  function localSkill(): string {
    const src = mkdtempSync(join(tmpdir(), 'cat-cmd-src-'));
    writeFileSync(
      join(src, 'LICENSE'),
      'MIT License\n\nPermission is hereby granted, free of charge, to any person.\nTHE SOFTWARE IS PROVIDED "AS IS".\n',
    );
    mkdirSync(join(src, 'lint-guide'));
    writeFileSync(
      join(src, 'lint-guide', 'SKILL.md'),
      '---\nname: lint-guide\ndescription: How we lint\ntools: [monograph_query]\n---\n\nRun the linter.\n',
    );
    return src;
  }

  it('refuses mutations without --actor', async () => {
    const { res } = await run(newRoot(), ['stage', localSkill()]);
    expect(res).toMatchObject({ success: false, exitCode: 1 });
    expect(res.message).toMatch(/--actor/);
  });

  it('stages, approves with exposure, activates and revokes', async () => {
    const root = newRoot();
    const staged = await run(root, ['stage', localSkill()], { actor: 'alice', format: 'json' });
    expect(JSON.parse(staged.out)).toMatchObject({ id: 'skill:lint-guide', before: null, after: 'staged' });
    vi.restoreAllMocks();
    const approved = await run(root, ['approve', 'skill:lint-guide'], {
      actor: 'alice',
      target: ['org', 'platform:agents'],
      grantTool: ['monograph_query'],
    });
    expect(approved.res.success).toBe(true);
    expect(approved.out).toMatch(/staged → approved/);
    expect(approved.out).toMatch(/platform:agents → \.agents\/skills, read by Codex/);
    vi.restoreAllMocks();
    const active = await run(root, ['activate', 'skill:lint-guide'], { actor: 'alice', format: 'json' });
    expect(JSON.parse(active.out)).toMatchObject({
      before: 'approved',
      after: 'active',
      grantedTools: ['monograph_query'],
    });
    vi.restoreAllMocks();
    const noReason = await run(root, ['revoke', 'skill:lint-guide'], { actor: 'alice' });
    expect(noReason.res.success).toBe(false);
    vi.restoreAllMocks();
    const revoked = await run(root, ['revoke', 'skill:lint-guide'], { actor: 'alice', reason: 'gone' });
    expect(revoked.out).toMatch(/active → revoked/);
    vi.restoreAllMocks();
    const inspected = await run(root, ['inspect', 'skill:lint-guide'], { format: 'json' });
    expect(JSON.parse(inspected.out)).toMatchObject({ status: 'revoked', inspection: { verdict: 'clean' } });
  });
});
