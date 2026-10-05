/**
 * #576: the project's `.monomind/catalog/` decides the skill content, the
 * grantedTools (MCP tools) and the blueprints org roles get at start, and the
 * org signature covers only the names. So no role may write it: it is an
 * operator-protected path (SDK denyWrite, the bubblewrap mask, the file-tool
 * deny pass), and `monomind catalog`'s mutating verbs refuse inside a role or
 * agent-exec process tree, like `org sign`. The operator's own use is
 * unchanged.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { statePath } from '../../src/catalog/state.js';
import { catalogAction } from '../../src/commands/catalog.js';
import { authorityMaskArgs, authorityMaskAvailability, ensureAuthorityDirs, maskedCommand } from '../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import {
  ensureOperatorProtectedPaths,
  maskReadOnlyPaths,
  operatorProtectedPaths,
} from '../../src/orgrt/operator-protected-paths.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';
import { newRoot, writeEntry } from './fixtures.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const MARKERS = ['MONOMIND_ORG_ROLE', 'MONOMIND_SDK_AGENT', 'MONOMIND_AGENT_EXEC', 'MONOMIND_CLINE_TURN', 'MONOMIND_AIDER'];

beforeEach(() => {
  // The operator's own terminal: whatever process runs this suite.
  for (const m of MARKERS) vi.stubEnv(m, '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a role cannot write .monomind/catalog/', () => {
  it('is in the protected path list for the org root and the role cwd', () => {
    const base = scratch('cp576-list-');
    const home = join(base, 'home');
    const root = join(base, 'root');
    const cwd = join(base, 'wt');
    const paths = operatorProtectedPaths({ home, env: { HOME: home }, orgRoot: root, cwd });
    expect(paths).toContain(join(root, '.monomind', 'catalog'));
    expect(paths).toContain(join(cwd, '.monomind', 'catalog'));
  });

  it('exists before a role starts (so it cannot be planted) and is read-only in the mask list', async () => {
    const base = scratch('cp576-ensure-');
    const home = join(base, 'home');
    const root = join(base, 'root');
    mkdirSync(root, { recursive: true });
    ensureOperatorProtectedPaths({ home, env: { HOME: home }, orgRoot: root });
    expect(existsSync(join(root, '.monomind', 'catalog'))).toBe(true);
    expect(maskReadOnlyPaths({ home, env: {}, orgRoot: root, cwd: root, homeDenyWrite: [] })).toContain(
      join(root, '.monomind', 'catalog'),
    );
    // An empty catalog dir is what no catalog was: not configured.
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => (out.push(String(c)), true));
    await catalogAction({ args: ['audit'], flags: { _: [], format: 'json' }, cwd: root, interactive: false });
    expect(JSON.parse(out.join(''))).toMatchObject({ ok: true, configured: false });
  });

  it('is in the SDK sandbox denyWrite', () => {
    const base = scratch('cp576-sdk-');
    const home = join(base, 'home');
    const cwd = join(base, 'wt');
    mkdirSync(cwd, { recursive: true });
    ensureOperatorProtectedPaths({ home, env: { HOME: home }, orgRoot: cwd });
    spawnSync('git', ['init', '-q', cwd]);
    const guard = prepareGitGuard({
      level: 'commit',
      stateDir: join(base, 'guard'),
      excludeSandboxPlaceholders: true,
      protectedGitDirs: [gitCommonDir(cwd) as string],
    });
    const r = buildClaudeRestrictions(
      guard as NonNullable<typeof guard>,
      undefined as never,
      { cwd, orgRoot: cwd, home, tmp: tmpdir(), env: { HOME: home }, platform: 'darwin' },
      true,
    );
    const fs = (r.sandbox as { filesystem: { denyWrite: string[] } }).filesystem;
    expect(fs.denyWrite).toContain(join(cwd, '.monomind', 'catalog'));
  });

  it('file tools deny writing the catalog state and packages, and still read them', async () => {
    const root = scratch('cp576-policy-');
    writeEntry(root, { name: 'audit', targets: ['org'] });
    const p = new PolicyEngine('dev', {} as never, new OrgBus('o', 'r', scratch('cp576-bus-')), root, [root], root);
    for (const f of ['.monomind/catalog/state.json', '.monomind/catalog/packages/audit/x/SKILL.md', '.monomind/catalog/new.json']) {
      const d = await p.decide('Write', { file_path: join(root, f), content: 'x' });
      expect(d.behavior, f).toBe('deny');
    }
    expect((await p.decide('Read', { file_path: statePath(root) })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: join(root, '.monomind', 'notes.md'), content: 'x' })).behavior).toBe('allow');
  });

  it('a signed policy.sandbox.allowWrite entry is the opt-in', async () => {
    const root = scratch('cp576-optin-');
    const p = new PolicyEngine(
      'dev',
      { sandbox: { allowWrite: ['.monomind/catalog'] } } as never,
      new OrgBus('o', 'r', scratch('cp576-bus-')),
      root,
      [root],
      root,
    );
    expect((await p.decide('Write', { file_path: statePath(root), content: 'x' })).behavior).toBe('allow');
  });

  it("an operator's refused stage keeps the pre-created dir (removing it would let a running role plant one)", async () => {
    const base = scratch('cp576-keep-');
    const home = join(base, 'home');
    const root = join(base, 'root');
    mkdirSync(root, { recursive: true });
    ensureOperatorProtectedPaths({ home, env: { HOME: home }, orgRoot: root });
    const src = mkdtempSync(join(tmpdir(), 'cp576-nolicense-'));
    writeFileSync(join(src, 'SKILL.md'), '---\nname: x\ndescription: y\n---\nhi\n');
    const { res } = await run(root, ['stage', src], { actor: 'alice' });
    expect(res.success).toBe(false);
    expect(existsSync(join(root, '.monomind', 'catalog'))).toBe(true);
    expect(existsSync(join(root, '.monomind', 'catalog', 'packages'))).toBe(false);
    // Without an org start first, a refused stage still leaves nothing.
    const plain = scratch('cp576-plain-');
    vi.restoreAllMocks();
    expect((await run(plain, ['stage', src], { actor: 'alice' })).res.success).toBe(false);
    expect(existsSync(join(plain, '.monomind', 'catalog'))).toBe(false);
  });

  it.runIf(authorityMaskAvailability().available)('inside the real bubblewrap mask the catalog is read-only', () => {
    const home = scratch('cp576-mhome-');
    const root = scratch('cp576-mroot-');
    const env = {} as NodeJS.ProcessEnv;
    ensureAuthorityDirs(home, env);
    writeEntry(root, { name: 'audit', targets: ['org'] });
    ensureOperatorProtectedPaths({ home, env, orgRoot: root });
    const before = readFileSync(statePath(root), 'utf8');
    const [cmd, argv] = maskedCommand(authorityMaskArgs({ home, env, roots: [root], orgRoot: root, cwd: root }), 'bash', [
      '-c',
      [`echo X > ${statePath(root)}`, `echo X > ${root}/.monomind/catalog/evil.json`, `echo ok > ${root}/work.txt`, 'true'].join('; '),
    ]);
    spawnSync(cmd, argv, { encoding: 'utf8' });
    expect(readFileSync(statePath(root), 'utf8')).toBe(before);
    expect(existsSync(join(root, '.monomind', 'catalog', 'evil.json'))).toBe(false);
    expect(readFileSync(join(root, 'work.txt'), 'utf8')).toBe('ok\n');
  });
});

function run(root: string, args: string[], flags: Record<string, unknown> = {}) {
  const out: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => (out.push(String(c)), true));
  vi.spyOn(console, 'log').mockImplementation((m?: unknown) => {
    out.push(`${String(m)}\n`);
  });
  return catalogAction({ args, flags: { _: [], ...flags }, cwd: root, interactive: false }).then((res) => ({
    res,
    out: out.join(''),
  }));
}

function localSkill(): string {
  const src = mkdtempSync(join(tmpdir(), 'cp576-src-'));
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

describe('monomind catalog inside a role', () => {
  it.each(MARKERS)('refuses every mutating verb under %s and changes nothing', async (marker) => {
    const root = newRoot('cp576-cli-');
    writeEntry(root, { name: 'audit', targets: ['org'] });
    const before = readFileSync(statePath(root), 'utf8');
    vi.stubEnv(marker, '1');
    const calls: [string[], Record<string, unknown>][] = [
      [['stage', localSkill()], { actor: 'r' }],
      [['approve', 'skill:audit'], { actor: 'r', target: ['org'], grantTool: ['monograph_query'] }],
      [['activate', 'skill:audit'], { actor: 'r' }],
      [['disable', 'skill:audit'], { actor: 'r' }],
      [['quarantine', 'skill:audit'], { actor: 'r', reason: 'x' }],
      [['release', 'skill:audit'], { actor: 'r', reason: 'x' }],
      [['revoke', 'skill:audit'], { actor: 'r', reason: 'x' }],
      [['project'], { surface: 'platform:claude', apply: true }],
      [['unproject', 'skill:audit'], { surface: 'platform:claude', apply: true }],
    ];
    for (const [args, flags] of calls) {
      const { res } = await run(root, args, flags);
      expect(res, args[0]).toMatchObject({ success: false, exitCode: 1 });
      expect(res.message, args[0]).toMatch(new RegExp(`Refusing: ${marker} is set.*Only the operator changes the catalog`));
    }
    expect(readFileSync(statePath(root), 'utf8')).toBe(before);
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('still runs the read-only verbs and projection dry runs', async () => {
    const root = newRoot('cp576-ro-');
    writeEntry(root, { name: 'audit', targets: ['org', 'platform:claude'] });
    vi.stubEnv('MONOMIND_ORG_ROLE', 'dev');
    for (const [args, flags] of [
      [['list'], { format: 'json' }],
      [['show', 'skill:audit'], { format: 'json' }],
      [['search', 'audit'], { format: 'json' }],
      [['audit'], { format: 'json' }],
      [['inspect', 'skill:audit'], { format: 'json' }],
      [['project'], { surface: 'platform:claude', format: 'json' }],
    ] as [string[], Record<string, unknown>][]) {
      vi.restoreAllMocks();
      const { res } = await run(root, args, flags);
      expect(res.success, args[0]).toBe(true);
    }
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });
});

describe('the operator uses the catalog as before', () => {
  it('stages, approves, activates and projects', async () => {
    const root = newRoot('cp576-op-');
    const staged = await run(root, ['stage', localSkill()], { actor: 'alice', format: 'json' });
    expect(JSON.parse(staged.out)).toMatchObject({ id: 'skill:lint-guide', after: 'staged' });
    vi.restoreAllMocks();
    const approved = await run(root, ['approve', 'skill:lint-guide'], {
      actor: 'alice',
      target: ['org', 'platform:claude'],
      grantTool: ['monograph_query'],
    });
    expect(approved.res.success).toBe(true);
    vi.restoreAllMocks();
    const active = await run(root, ['activate', 'skill:lint-guide'], { actor: 'alice', format: 'json' });
    expect(JSON.parse(active.out)).toMatchObject({ after: 'active', grantedTools: ['monograph_query'] });
    vi.restoreAllMocks();
    const projected = await run(root, ['project'], { surface: 'platform:claude', apply: true, format: 'json' });
    expect(projected.res.success).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'lint-guide', 'SKILL.md'))).toBe(true);
  });
});
