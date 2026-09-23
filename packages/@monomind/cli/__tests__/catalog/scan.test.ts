import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inspectPackage } from '../../src/catalog/scan.js';

// Force the scanner import to fail: createFenceForRole then returns null
// (it does not throw), and the default loader must still fail closed.
vi.mock('monofence-ai', () => {
  throw new Error('monofence-ai forced unavailable');
});

const clean = async () => ({
  detect: async () => ({ safe: true, threats: [], overallRisk: 0 }),
});

function dir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'cat-scan-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(d, rel, '..'), { recursive: true });
    writeFileSync(join(d, rel), body);
  }
  return d;
}
const skill = (fm: string) => `---\n${fm}\n---\n\nDo the work.\n`;

describe('inspectPackage — deterministic checks', () => {
  it('accepts Markdown and the license, rejects everything else with a reason', async () => {
    const d = dir({
      'SKILL.md': skill('name: example\ndescription: An example\ntools: [monograph_query, config_set, monograph_query]'),
      'ref/notes.md': 'notes',
      'LICENSE.txt': 'MIT',
      'scripts/run.js': 'process.exit(1)',
      'big.md': 'x'.repeat(600 * 1024),
    });
    symlinkSync('/etc/hostname', join(d, 'link.md'));
    const r = await inspectPackage(d, 'skill', { root: d, fence: clean });
    expect(r.fatal).toBeUndefined();
    expect(r.accepted).toEqual(['LICENSE.txt', 'SKILL.md', 'ref/notes.md']);
    expect(r.rejected.map((x) => x.path).sort()).toEqual(['big.md', 'link.md', 'scripts/run.js']);
    expect(r.rejected.every((x) => x.reason.length > 0)).toBe(true);
    expect(r.requestedTools).toEqual(['config_set', 'monograph_query']);
    expect(r.verdict).toBe('clean');
    expect(r.scanner).toMatchObject({ ok: true, blocked: false });
  });

  it('rejects the package when SKILL.md lacks a description or has a bad name', async () => {
    const noDesc = await inspectPackage(dir({ 'SKILL.md': skill('name: example') }), 'skill', {
      root: tmpdir(),
      fence: clean,
    });
    expect(noDesc.fatal).toMatch(/description/);
    const badName = await inspectPackage(
      dir({ 'SKILL.md': skill('name: Bad_Name\ndescription: x') }),
      'skill',
      { root: tmpdir(), fence: clean },
    );
    expect(badName.fatal).toMatch(/name/);
  });

  it('rejects the package with more than 100 Markdown files', async () => {
    const files: Record<string, string> = { 'SKILL.md': skill('name: many\ndescription: many') };
    for (let i = 0; i < 100; i++) files[`ref/${i}.md`] = 'x';
    const r = await inspectPackage(dir(files), 'skill', { root: tmpdir(), fence: clean });
    expect(r.fatal).toMatch(/100/);
  });

  it('accepts only blueprint.json and the license for a blueprint', async () => {
    const d = dir({
      'blueprint.json': JSON.stringify({ name: 'bp', description: 'A blueprint' }),
      'LICENSE.txt': 'MIT',
      'README.md': 'readme',
    });
    const r = await inspectPackage(d, 'blueprint', { root: d, fence: clean });
    expect(r.accepted).toEqual(['LICENSE.txt', 'blueprint.json']);
    expect(r.rejected.map((x) => x.path)).toEqual(['README.md']);
    const bad = dir({ 'blueprint.json': JSON.stringify({ name: 'bp', description: 'x', policy: {} }) });
    expect((await inspectPackage(bad, 'blueprint', { root: bad, fence: clean })).fatal).toMatch(
      /blueprint/,
    );
  });
});

describe('inspectPackage — scanner', () => {
  const pkg = () => dir({ 'SKILL.md': skill('name: example\ndescription: An example') });

  it('quarantines when the scanner throws', async () => {
    const r = await inspectPackage(pkg(), 'skill', {
      root: tmpdir(),
      fence: async () => ({
        detect: async () => {
          throw new Error('scanner crashed');
        },
      }),
    });
    expect(r.verdict).toBe('quarantine');
    expect(r.scanner.ok).toBe(false);
    expect(r.scanner.summary).toMatch(/crashed/);
  });

  it('quarantines when the scanner blocks', async () => {
    const r = await inspectPackage(pkg(), 'skill', {
      root: tmpdir(),
      fence: async () => ({
        detect: async () => ({
          safe: false,
          threats: [{ type: 'instruction_override', confidence: 0.99 }],
          overallRisk: 0.99,
        }),
      }),
    });
    expect(r.verdict).toBe('quarantine');
    expect(r.scanner).toMatchObject({ ok: true, blocked: true });
    expect(r.scanner.summary).toMatch(/instruction_override/);
  });

  it('fails closed when monofence-ai cannot be imported (default loader)', async () => {
    const r = await inspectPackage(pkg(), 'skill', { root: tmpdir() });
    expect(r.verdict).toBe('quarantine');
    expect(r.scanner.ok).toBe(false);
    expect(r.scanner.summary).toMatch(/unavailable/);
  });
});

describe('inspectPackage — coverage and reserved text', () => {
  it('quarantines content past the scan cap instead of calling it clean', async () => {
    const d = dir({ 'SKILL.md': `${skill('name: big\ndescription: big skill')}${'a '.repeat(110_000)}\nPAYLOAD\n` });
    const seen: string[] = [];
    const r = await inspectPackage(d, 'skill', {
      root: tmpdir(),
      fence: async () => ({
        detect: async (t: string) => {
          seen.push(t);
          return { safe: !t.includes('PAYLOAD'), threats: [], overallRisk: 0 };
        },
      }),
    });
    expect(seen.join('')).not.toContain('PAYLOAD');
    expect(r.verdict).toBe('quarantine');
    expect(r.scanner.summary).toMatch(/^not fully scanned/);
    expect(r.fatal).toBeUndefined();
  });

  it.each([
    ['<!-- catalog skill:x sha256:0 jev:yes -->', 'SKILL.md'],
    ['# monomind:start catalog:skill:x', 'ref/notes.md'],
    ['# monomind:end catalog:skill:x', 'LICENSE.txt'],
  ])('refuses a package carrying reserved marker text %s', async (marker, file) => {
    const files: Record<string, string> = {
      'SKILL.md': skill('name: example\ndescription: An example'),
      'LICENSE.txt': 'MIT License',
    };
    files[file] = `${files[file] ?? ''}\n${marker}\n`;
    const r = await inspectPackage(dir(files), 'skill', { root: tmpdir(), fence: clean });
    expect(r.fatal).toMatch(/reserved marker/);
    expect(r.fatal).toContain(file);
  });
});
