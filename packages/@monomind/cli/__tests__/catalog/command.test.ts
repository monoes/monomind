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
