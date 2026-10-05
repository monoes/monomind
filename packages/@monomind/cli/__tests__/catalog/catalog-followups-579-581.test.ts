/**
 * Follow-ups from the #577 review:
 * - #579: `cleanup --force` keeps `.monomind/catalog/` (operator data) unless
 *   `--purge-data` is given;
 * - #580: `.agents/skills`, the catalog's other projection surface (loaded by
 *   Codex, Gemini, Kimi, OpenCode… operator sessions), is operator-protected
 *   the way `.claude/` is;
 * - #581: the catalog lock lives inside the protected `.monomind/catalog/`,
 *   so a role cannot create it and block the operator's catalog changes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogDir } from '../../src/catalog/digest.js';
import { loadCatalogState, lockPath, mutateCatalogState } from '../../src/catalog/state.js';
import { cleanupCommand } from '../../src/commands/cleanup.js';
import { authorityMaskArgs, authorityMaskAvailability, ensureAuthorityDirs, maskedCommand } from '../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import {
  ensureOperatorProtectedPaths,
  maskReadOnlyPaths,
  operatorProtectedPaths,
} from '../../src/orgrt/operator-protected-paths.js';
import { plantCandidates } from '../../src/orgrt/planted-paths.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';
import type { CommandContext } from '../../src/types.js';
import { newRoot, writeEntry } from './fixtures.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const write = (root: string, rel: string, content = 'x') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};

describe('#579: cleanup keeps catalog state unless --purge-data', () => {
  let cwd: string | undefined;
  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });
  const cleanup = (flags: Record<string, unknown>) =>
    cleanupCommand.action?.({ cwd, flags, args: [] } as unknown as CommandContext);

  it('--force alone keeps .monomind/catalog; --purge-data removes it', async () => {
    cwd = scratch('cf579-');
    spawnSync('git', ['init', '-q', cwd]);
    writeEntry(cwd, { name: 'audit', targets: ['org'] });
    write(cwd, '.monomind/last-route.json', '{}');
    const state = join(cwd, '.monomind', 'catalog', 'state.json');
    expect(existsSync(state)).toBe(true);

    await cleanup({ force: true });
    expect(existsSync(state)).toBe(true);
    expect(existsSync(join(cwd, '.monomind', 'catalog', 'packages'))).toBe(true);
    expect(existsSync(join(cwd, '.monomind', 'last-route.json'))).toBe(false);

    await cleanup({ force: true, 'purge-data': true });
    expect(existsSync(join(cwd, '.monomind', 'catalog'))).toBe(false);
  });
});

describe('#580: .agents/skills is operator-protected', () => {
  it('is in the protected path list for the org root and the role cwd, and in the plant watch', () => {
    const base = scratch('cf580-list-');
    const home = join(base, 'home');
    const root = join(base, 'root');
    const cwd = join(base, 'wt');
    const ctx = { home, env: { HOME: home }, orgRoot: root, cwd };
    const paths = operatorProtectedPaths(ctx);
    expect(paths).toContain(join(root, '.agents', 'skills'));
    expect(paths).toContain(join(cwd, '.agents', 'skills'));
    // Missing at a role's start: a plant there is caught and quarantined.
    expect(plantCandidates(ctx)).toContain(join(cwd, '.agents', 'skills'));
    // Not the rest of .agents (shared_instructions.md and the like).
    expect(paths).not.toContain(join(root, '.agents'));
  });

  it('is not pre-created at org start (no stray .agents/ in a repo), and is read-only in the mask once it exists', () => {
    const base = scratch('cf580-ensure-');
    const home = join(base, 'home');
    const root = join(base, 'root');
    mkdirSync(root, { recursive: true });
    ensureOperatorProtectedPaths({ home, env: { HOME: home }, orgRoot: root });
    expect(existsSync(join(root, '.agents'))).toBe(false);
    const mask = () => maskReadOnlyPaths({ home, env: {}, orgRoot: root, cwd: root, homeDenyWrite: [] });
    expect(mask()).not.toContain(join(root, '.agents', 'skills'));
    mkdirSync(join(root, '.agents', 'skills'), { recursive: true });
    expect(mask()).toContain(join(root, '.agents', 'skills'));
  });

  it.each(['darwin', 'linux'] as const)('is in the SDK sandbox denyWrite (%s)', (platform) => {
    const base = scratch('cf580-sdk-');
    const home = join(base, 'home');
    const cwd = join(base, 'wt');
    mkdirSync(join(cwd, '.agents', 'skills'), { recursive: true });
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
      { cwd, orgRoot: cwd, home, tmp: tmpdir(), env: { HOME: home }, platform },
      true,
    );
    const fs = (r.sandbox as { filesystem: { denyWrite: string[] } }).filesystem;
    expect(fs.denyWrite).toContain(join(cwd, '.agents', 'skills'));
  });

  it('file tools deny writing a skill there, still read it, and allow the rest of .agents', async () => {
    const root = scratch('cf580-policy-');
    write(root, '.agents/skills/lint/SKILL.md', '---\nname: lint\n---\n');
    const p = new PolicyEngine('dev', {} as never, new OrgBus('o', 'r', scratch('cf580-bus-')), root, [root], root);
    for (const f of ['.agents/skills/lint/SKILL.md', '.agents/skills/evil/SKILL.md']) {
      const d = await p.decide('Write', { file_path: join(root, f), content: 'x' });
      expect(d.behavior, f).toBe('deny');
    }
    expect((await p.decide('Read', { file_path: join(root, '.agents/skills/lint/SKILL.md') })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: join(root, '.agents', 'notes.md'), content: 'x' })).behavior).toBe('allow');
  });

  it('a signed policy.sandbox.allowWrite entry is the opt-in', async () => {
    const root = scratch('cf580-optin-');
    const p = new PolicyEngine(
      'dev',
      { sandbox: { allowWrite: ['.agents/skills'] } } as never,
      new OrgBus('o', 'r', scratch('cf580-bus-')),
      root,
      [root],
      root,
    );
    const d = await p.decide('Write', { file_path: join(root, '.agents/skills/x/SKILL.md'), content: 'x' });
    expect(d.behavior).toBe('allow');
  });

  it.runIf(authorityMaskAvailability().available)('inside the real bubblewrap mask .agents/skills is read-only', () => {
    const home = scratch('cf580-mhome-');
    const root = scratch('cf580-mroot-');
    const env = {} as NodeJS.ProcessEnv;
    ensureAuthorityDirs(home, env);
    mkdirSync(join(root, '.agents', 'skills'), { recursive: true });
    ensureOperatorProtectedPaths({ home, env, orgRoot: root });
    const [cmd, argv] = maskedCommand(authorityMaskArgs({ home, env, roots: [root], orgRoot: root, cwd: root }), 'bash', [
      '-c',
      [
        `mkdir -p ${root}/.agents/skills/evil && echo X > ${root}/.agents/skills/evil/SKILL.md`,
        `mv ${root}/.agents ${root}/.agents-aside`,
        `echo ok > ${root}/.agents/notes.md`,
        'true',
      ].join('; '),
    ]);
    spawnSync(cmd, argv, { encoding: 'utf8' });
    expect(existsSync(join(root, '.agents', 'skills', 'evil'))).toBe(false);
    expect(existsSync(join(root, '.agents-aside'))).toBe(false);
  });
});

describe('#581: the catalog lock is inside the protected catalog dir', () => {
  it('lives under .monomind/catalog/, which roles cannot write', () => {
    const root = newRoot('cf581-path-');
    expect(dirname(lockPath(root))).toBe(catalogDir(root));
    const home = join(root, 'home');
    expect(operatorProtectedPaths({ home, env: { HOME: home }, orgRoot: root })).toContain(catalogDir(root));
  });

  it('a lock at the new path still refuses a concurrent mutation', () => {
    const root = newRoot('cf581-held-');
    mkdirSync(catalogDir(root), { recursive: true });
    writeFileSync(lockPath(root), '');
    expect(() => mutateCatalogState(root, (s) => s)).toThrow(/locked/);
  });

  it('a leftover (or role-planted) legacy .monomind/locks/catalog.lock no longer blocks, and is left alone', () => {
    const root = newRoot('cf581-legacy-');
    writeEntry(root, { name: 'audit', targets: ['org'] });
    const legacy = join(root, '.monomind', 'locks', 'catalog.lock');
    write(root, '.monomind/locks/catalog.lock', '');
    mutateCatalogState(root, (s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, updatedAt: '2026-09-30T12:00:00.000Z' })) }));
    expect(loadCatalogState(root).entries[0].updatedAt).toBe('2026-09-30T12:00:00.000Z');
    expect(existsSync(legacy)).toBe(true);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  it('a refused mutation on a project with no catalog leaves no directory behind', () => {
    const root = newRoot('cf581-clean-');
    expect(() =>
      mutateCatalogState(root, () => {
        throw new Error('refused');
      }),
    ).toThrow('refused');
    expect(existsSync(join(root, '.monomind'))).toBe(false);
  });
});
