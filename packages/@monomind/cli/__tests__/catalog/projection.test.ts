import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disable, revoke } from '../../src/catalog/lifecycle.js';
import { applyProjection, planProjection } from '../../src/catalog/projection.js';
import { catalogAction } from '../../src/commands/catalog.js';
import { statePath } from '../../src/catalog/state.js';
import { type EntrySpec, NOW, newRoot, tamper, writeEntry } from './fixtures.js';

/** Hash of every path and byte below `dir`, never following symlinks. */
function hashTree(dir: string): string {
  const h = createHash('sha256');
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const p = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, p));
      h.update(`${p}\0${st.isSymbolicLink() ? 'L' : st.isDirectory() ? 'D' : 'F'}\0`);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) h.update(readFileSync(join(dir, p)));
    }
  };
  walk('');
  return h.digest('hex');
}

const skillMd = (name: string, description = `${name} skill`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nBODY-SENTINEL for ${name}\n`;
const pkg = (name: string) => ({
  'SKILL.md': skillMd(name),
  'ref/notes.md': `# ${name} notes\n`,
  'LICENSE.txt': 'MIT License',
});
const FILES_PER_SKILL = 3;

function seedForeign(root: string, base = '.claude/skills'): void {
  mkdirSync(join(root, base, 'foreign'), { recursive: true });
  writeFileSync(join(root, base, 'foreign', 'SKILL.md'), skillMd('foreign'));
  mkdirSync(join(root, base, 'cat-review'), { recursive: true });
  writeFileSync(join(root, base, 'cat-review', 'SKILL.md'), skillMd('cat-review', 'user owned'));
}

const actor = { actor: 'tester', now: NOW };

/** Stores a new revision of `spec.name` and makes it the only state entry for that id. */
function replaceRevision(root: string, spec: EntrySpec) {
  const file = statePath(root);
  const state = JSON.parse(readFileSync(file, 'utf8'));
  state.entries = state.entries.filter((e: { id: string }) => e.id !== `skill:${spec.name}`);
  writeFileSync(file, JSON.stringify(state, null, 2));
  const next = writeEntry(root, spec);
  const later = new Date(Date.now() + 10_000);
  utimesSync(file, later, later);
  return next;
}

describe('catalog projection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('dry run predicts the apply, foreign content survives, and a second apply changes nothing', async () => {
    const root = newRoot();
    seedForeign(root);
    writeEntry(root, { name: 'cat-review', targets: ['org', 'platform:claude'] });
    const lint = writeEntry(root, { name: 'cat-lint', targets: ['org', 'platform:claude'], files: pkg('cat-lint') });
    writeEntry(root, { name: 'cat-docs', targets: ['platform:claude'], files: pkg('cat-docs') });
    writeEntry(root, { name: 'cat-agents', targets: ['platform:agents'] });
    writeEntry(root, { name: 'cat-staged', status: 'staged' });
    writeEntry(root, { name: 'cat-org', targets: ['org'] });
    const foreignBefore = hashTree(join(root, '.claude/skills/foreign'));
    const reviewBefore = hashTree(join(root, '.claude/skills/cat-review'));

    const dry = await applyProjection(root, 'platform:claude', { dryRun: true });
    expect(existsSync(join(root, '.claude/skills/cat-lint'))).toBe(false);
    expect(existsSync(join(root, '.monomind/locks'))).toBe(false);
    expect(existsSync(join(root, '.monomind/backups'))).toBe(false);

    const real = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(dry.changed).toEqual(real.changed);
    expect([...real.changed].sort()).toEqual(
      ['cat-docs', 'cat-lint'].flatMap((n) =>
        ['LICENSE.txt', 'SKILL.md', 'ref/notes.md'].map((f) => `.claude/skills/${n}/${f}`),
      ),
    );
    expect(hashTree(join(root, '.claude/skills/foreign'))).toBe(foreignBefore);
    expect(hashTree(join(root, '.claude/skills/cat-review'))).toBe(reviewBefore);
    expect(real.diagnostics).toContainEqual(expect.stringMatching(/cat-review.*not catalog-managed/));

    const skill = readFileSync(join(root, '.claude/skills/cat-lint/SKILL.md'), 'utf8');
    expect(skill).toMatch(/^---\nname: cat-lint\ndescription: cat-lint skill\n---\n/);
    expect(skill).toContain('monomind:start catalog:skill:cat-lint');
    expect(skill).toContain(`<!-- catalog skill:cat-lint sha256:${lint.sha256} jev:no -->`);
    expect(skill).toContain('BODY-SENTINEL for cat-lint');
    for (const absent of ['cat-agents', 'cat-staged', 'cat-org'])
      expect(existsSync(join(root, '.claude/skills', absent))).toBe(false);
    expect(existsSync(join(root, '.agents'))).toBe(false);

    expect((await applyProjection(root, 'platform:claude', { dryRun: false })).changed).toEqual([]);
    const plan = await planProjection(root, 'platform:claude');
    expect(plan.intents).toHaveLength(2 * FILES_PER_SKILL);
    expect(plan.removals).toEqual([]);
    expect(new Set(plan.intents.map((i) => i.marker))).toEqual(
      new Set(['catalog:skill:cat-lint', 'catalog:skill:cat-docs']),
    );
  });

  it('platform:agents projects into .agents/skills only', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'cat-agents', targets: ['platform:agents'] });
    writeEntry(root, { name: 'cat-claude', targets: ['platform:claude'] });
    const res = await applyProjection(root, 'platform:agents', { dryRun: false });
    expect([...res.changed].sort()).toEqual([
      '.agents/skills/cat-agents/LICENSE.txt',
      '.agents/skills/cat-agents/SKILL.md',
    ]);
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('a digest-tampered package yields a diagnostic and no intent', async () => {
    const root = newRoot();
    const bad = writeEntry(root, { name: 'cat-bad', targets: ['platform:claude'] });
    writeEntry(root, { name: 'cat-good', targets: ['platform:claude'] });
    tamper(bad);
    const plan = await planProjection(root, 'platform:claude');
    expect(plan.intents.every((i) => i.marker === 'catalog:skill:cat-good')).toBe(true);
    expect(plan.diagnostics).toContainEqual(expect.stringMatching(/skill:cat-bad.*digest-mismatch/));
  });

  it('with no active entries a dry run is empty and creates no directories', async () => {
    const empty = newRoot();
    const plan = await applyProjection(empty, 'platform:claude', { dryRun: true });
    expect(plan).toMatchObject({ intents: [], removals: [], changed: [] });
    expect(readdirSync(empty)).toEqual([]);

    const staged = newRoot();
    writeEntry(staged, { name: 'cat-staged', status: 'staged' });
    const before = hashTree(staged);
    expect((await applyProjection(staged, 'platform:claude', { dryRun: true })).intents).toEqual([]);
    expect((await applyProjection(staged, 'platform:claude', { dryRun: false })).changed).toEqual([]);
    expect(hashTree(staged)).toBe(before);
  });

  it('after disable the next apply removes that catalog package dir and only it', async () => {
    const root = newRoot();
    seedForeign(root);
    writeEntry(root, { name: 'cat-lint', targets: ['platform:claude'], files: pkg('cat-lint') });
    writeEntry(root, { name: 'cat-keep', targets: ['platform:claude'] });
    await applyProjection(root, 'platform:claude', { dryRun: false });
    const keepBefore = hashTree(join(root, '.claude/skills/cat-keep'));
    const foreignBefore = hashTree(join(root, '.claude/skills/foreign'));
    disable(root, 'skill:cat-lint', actor);

    const dry = await applyProjection(root, 'platform:claude', { dryRun: true });
    expect(dry.removals.map((r) => r.id)).toEqual(['skill:cat-lint']);
    const real = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(dry.changed).toEqual(real.changed);
    expect(existsSync(join(root, '.claude/skills/cat-lint'))).toBe(false);
    expect(hashTree(join(root, '.claude/skills/cat-keep'))).toBe(keepBefore);
    expect(hashTree(join(root, '.claude/skills/foreign'))).toBe(foreignBefore);
    expect((await applyProjection(root, 'platform:claude', { dryRun: false })).changed).toEqual([]);
  });

  it('after revoke the next apply removes the projected copy and keeps the package bytes', async () => {
    const root = newRoot();
    const e = writeEntry(root, { name: 'cat-gone', targets: ['platform:agents'] });
    await applyProjection(root, 'platform:agents', { dryRun: false });
    expect(existsSync(join(root, '.agents/skills/cat-gone/SKILL.md'))).toBe(true);
    const bytes = hashTree(e.dir);
    revoke(root, 'skill:cat-gone', { ...actor, reason: 'withdrawn' });
    const real = await applyProjection(root, 'platform:agents', { dryRun: false });
    expect(real.removals.map((r) => r.id)).toEqual(['skill:cat-gone']);
    expect(existsSync(join(root, '.agents/skills/cat-gone'))).toBe(false);
    expect(hashTree(e.dir)).toBe(bytes);
  });

  it('unproject removes one id, and a user file inside the package keeps its directory', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'cat-lint', targets: ['platform:claude'] });
    writeEntry(root, { name: 'cat-keep', targets: ['platform:claude'] });
    await applyProjection(root, 'platform:claude', { dryRun: false });
    writeFileSync(join(root, '.claude/skills/cat-lint/mine.md'), 'user\n');
    const res = await applyProjection(root, 'platform:claude', { dryRun: false, unproject: 'skill:cat-lint' });
    expect(res.intents).toEqual([]);
    expect(existsSync(join(root, '.claude/skills/cat-lint/SKILL.md'))).toBe(false);
    expect(readFileSync(join(root, '.claude/skills/cat-lint/mine.md'), 'utf8')).toBe('user\n');
    expect(existsSync(join(root, '.claude/skills/cat-keep/SKILL.md'))).toBe(true);
    await expect(planProjection(root, 'platform:claude', { unproject: 'skill:../../x' })).rejects.toThrow(
      /catalog id/,
    );
  });

  it('a new revision removes the files only the old revision projected', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'cat-lint', targets: ['platform:claude'], files: pkg('cat-lint') });
    await applyProjection(root, 'platform:claude', { dryRun: false });
    const dir = join(root, '.claude/skills/cat-lint');
    writeFileSync(join(dir, 'mine.md'), 'user\n');
    const next = replaceRevision(root, {
      name: 'cat-lint',
      targets: ['platform:claude'],
      files: { 'SKILL.md': skillMd('cat-lint'), 'LICENSE.txt': 'Apache License' },
    });

    const dry = await applyProjection(root, 'platform:claude', { dryRun: true });
    expect(existsSync(join(dir, 'ref/notes.md'))).toBe(true);
    const real = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(dry.changed).toEqual(real.changed);
    expect(real.removals.map((r) => r.id)).toEqual(['skill:cat-lint']);
    expect(existsSync(join(dir, 'ref'))).toBe(false);
    expect(readFileSync(join(dir, 'mine.md'), 'utf8')).toBe('user\n');
    expect(readFileSync(join(dir, 'LICENSE.txt'), 'utf8')).toContain('Apache License');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toContain(`sha256:${next.sha256}`);
    const backups = join(root, '.monomind/backups');
    const saved = readdirSync(backups).map((b) => join(backups, b, '.claude/skills/cat-lint'));
    expect(saved.some((b) => existsSync(join(b, 'ref/notes.md')))).toBe(true);
    expect(saved.some((b) => existsSync(join(b, 'SKILL.md')))).toBe(true);
    const again = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(again).toMatchObject({ changed: [], removals: [] });
  });

  it('a same-name non-skill entry does not keep a stale skill projection alive', async () => {
    const root = newRoot();
    const dir = join(root, '.claude/skills/cat-arch');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      '---\nname: cat-arch\n---\n# monomind:start catalog:skill:cat-arch\nold\n# monomind:end catalog:skill:cat-arch\n',
    );
    writeEntry(root, { name: 'cat-arch', kind: 'archetype', targets: ['platform:claude'] });
    const res = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(res.diagnostics).toContainEqual(expect.stringMatching(/archetype:cat-arch: only skills/));
    expect(res.removals.map((r) => r.id)).toEqual(['skill:cat-arch']);
    expect(existsSync(dir)).toBe(false);
  });

  it('refuses a package whose frontmatter carries keys outside the allow-list', async () => {
    const root = newRoot();
    const hooks = [
      '---',
      'name: cat-hooks',
      'description: d',
      'allowed-tools: Bash, Write',
      'hooks:',
      '  PreToolUse:',
      '    - command: touch /tmp/pwned',
      '---',
      'body',
      '',
    ].join('\n');
    writeEntry(root, { name: 'cat-hooks', targets: ['platform:claude'], files: { 'SKILL.md': hooks } });
    const flow = '---\n{name: cat-flow, description: d, model: opus}\n---\nbody\n';
    writeEntry(root, { name: 'cat-flow', targets: ['platform:claude'], files: { 'SKILL.md': flow } });
    const ok = '---\nname: cat-ok\ndescription: d\ntags:\n- a\n- b\ntools: []\nlicense: MIT\n---\nbody\n';
    writeEntry(root, { name: 'cat-ok', targets: ['platform:claude'], files: { 'SKILL.md': ok } });
    const res = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(res.diagnostics).toContainEqual('skill:cat-hooks: frontmatter-not-allowed: allowed-tools, hooks');
    expect(res.diagnostics).toContainEqual(expect.stringMatching(/^skill:cat-flow: frontmatter-not-allowed/));
    expect(res.packages.map((p) => p.id)).toEqual(['skill:cat-ok']);
    expect(existsSync(join(root, '.claude/skills/cat-hooks'))).toBe(false);
    expect(existsSync(join(root, '.claude/skills/cat-flow'))).toBe(false);
  });

  it('reports frontmatter drift instead of silently keeping the old header', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'cat-lint', targets: ['platform:claude'] });
    await applyProjection(root, 'platform:claude', { dryRun: false });
    const file = join(root, '.claude/skills/cat-lint/SKILL.md');
    const drifted = readFileSync(file, 'utf8').replace('description: cat-lint skill', 'description: older text');
    writeFileSync(file, drifted);
    const res = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(res.diagnostics).toContainEqual(expect.stringMatching(/skill:cat-lint.*frontmatter-drift/));
    expect(res.changed).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(drifted);
  });
});

describe('catalog projection (adversarial destinations)', () => {
  it('a symlinked package dir pointing outside the root is neither written nor deleted', async () => {
    const root = newRoot();
    const outside = mkdtempSync(join(tmpdir(), 'cat-outside-'));
    writeFileSync(join(outside, 'keep.md'), 'outside\n');
    mkdirSync(join(root, '.claude/skills'), { recursive: true });
    symlinkSync(outside, join(root, '.claude/skills/cat-review'));
    writeEntry(root, { name: 'cat-review', targets: ['platform:claude'] });
    const before = hashTree(outside);
    const res = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(res.changed).toEqual([]);
    expect(res.diagnostics).toContainEqual(expect.stringMatching(/skill:cat-review.*symlinked-destination/));
    expect(hashTree(outside)).toBe(before);
  });

  it('a symlinked catalog-marked dir is not removed through the link', async () => {
    const root = newRoot();
    const outside = mkdtempSync(join(tmpdir(), 'cat-outside-'));
    writeFileSync(
      join(outside, 'SKILL.md'),
      '---\nname: cat-gone\n---\n# monomind:start catalog:skill:cat-gone\nx\n# monomind:end catalog:skill:cat-gone\n',
    );
    mkdirSync(join(root, '.claude/skills'), { recursive: true });
    symlinkSync(outside, join(root, '.claude/skills/cat-gone'));
    writeEntry(root, { name: 'cat-other', targets: ['org'] });
    const before = hashTree(outside);
    await applyProjection(root, 'platform:claude', { dryRun: false });
    const res = await applyProjection(root, 'platform:claude', { dryRun: false, unproject: 'skill:cat-gone' });
    expect(res.changed).toEqual([]);
    expect(res.diagnostics).toContainEqual(expect.stringMatching(/symlinked-destination/));
    expect(hashTree(outside)).toBe(before);
  });

  it('a symlinked surface root (.agents) refuses every package', async () => {
    const root = newRoot();
    const outside = mkdtempSync(join(tmpdir(), 'cat-outside-'));
    symlinkSync(outside, join(root, '.agents'));
    writeEntry(root, { name: 'cat-agents', targets: ['platform:agents'] });
    const res = await applyProjection(root, 'platform:agents', { dryRun: false });
    expect(res.changed).toEqual([]);
    expect(res.diagnostics).toContainEqual(expect.stringMatching(/symlinked-destination/));
    expect(readdirSync(outside)).toEqual([]);
  });

  it('an unmarked reference file skips the whole package and stays byte-identical', async () => {
    const root = newRoot();
    const notes = join(root, '.claude/skills/cat-lint/ref/notes.md');
    mkdirSync(join(notes, '..'), { recursive: true });
    writeFileSync(notes, 'my own notes\n');
    writeEntry(root, { name: 'cat-lint', targets: ['platform:claude'], files: pkg('cat-lint') });
    const res = await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(res.changed).toEqual([]);
    expect(res.diagnostics).toContainEqual(expect.stringMatching(/cat-lint.*not catalog-managed.*notes\.md/));
    expect(readFileSync(notes, 'utf8')).toBe('my own notes\n');
    expect(existsSync(join(root, '.claude/skills/cat-lint/SKILL.md'))).toBe(false);
  });
});

describe('monomind catalog project / unproject', () => {
  afterEach(() => vi.restoreAllMocks());

  function run(root: string, args: string[], flags: Record<string, unknown> = {}) {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
      out.push(`${String(m)}\n`);
    });
    return catalogAction({ args, flags: { _: [], ...flags }, cwd: root, interactive: false }).then((res) => ({
      res,
      out: out.join(''),
    }));
  }

  it('is a dry run by default and mutates only with --apply', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'cat-lint', targets: ['platform:claude'] });
    const dry = await run(root, ['project'], { surface: 'platform:claude', format: 'json' });
    expect(dry.res.success).toBe(true);
    const payload = JSON.parse(dry.out);
    expect(payload).toMatchObject({ surface: 'platform:claude', dryRun: true });
    expect(payload.intents).toHaveLength(2);
    expect(existsSync(join(root, '.claude'))).toBe(false);
    vi.restoreAllMocks();
    const applied = await run(root, ['project'], { surface: 'platform:claude', apply: true, format: 'json' });
    expect(JSON.parse(applied.out).changed).toContain('.claude/skills/cat-lint/SKILL.md');
    vi.restoreAllMocks();
    await run(root, ['unproject', 'skill:cat-lint'], { surface: 'platform:claude', apply: true });
    expect(existsSync(join(root, '.claude/skills/cat-lint'))).toBe(false);
  });

  it('disable and revoke point at a projected copy that is still on disk', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'cat-lint', targets: ['platform:claude', 'platform:agents'] });
    writeEntry(root, { name: 'cat-gone', targets: ['platform:agents'] });
    writeEntry(root, { name: 'cat-never', targets: ['platform:claude'] });
    await applyProjection(root, 'platform:claude', { dryRun: false });
    await applyProjection(root, 'platform:agents', { dryRun: false });
    rmSync(join(root, '.claude/skills/cat-never'), { recursive: true });
    const flags = { actor: 'tester', reason: 'test' };

    const off = await run(root, ['disable', 'skill:cat-lint'], flags);
    expect(off.res.success).toBe(true);
    for (const s of ['platform:claude', 'platform:agents'])
      expect(off.out).toContain(`still projected to ${s}; run catalog project --surface ${s} --apply`);
    vi.restoreAllMocks();
    const gone = await run(root, ['revoke', 'skill:cat-gone'], { ...flags, format: 'json' });
    expect(JSON.parse(gone.out).stillProjected).toEqual(['platform:agents']);
    vi.restoreAllMocks();
    const never = await run(root, ['disable', 'skill:cat-never'], flags);
    expect(never.out).not.toContain('still projected');
    expect(existsSync(join(root, '.claude/skills/cat-lint/SKILL.md'))).toBe(true);
  });

  it('prints an empty plan for an unconfigured project and rejects a bad surface', async () => {
    const root = newRoot();
    const { out } = await run(root, ['project'], { surface: 'platform:claude', format: 'json' });
    expect(JSON.parse(out)).toMatchObject({ intents: [], removals: [] });
    expect(readdirSync(root)).toEqual([]);
    vi.restoreAllMocks();
    expect((await run(root, ['project'], { surface: 'org' })).res).toMatchObject({ success: false, exitCode: 1 });
    expect((await run(root, ['unproject'], { surface: 'platform:claude' })).res).toMatchObject({ success: false });
  });
});
