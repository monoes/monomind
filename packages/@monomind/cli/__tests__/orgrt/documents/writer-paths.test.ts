// packages/@monomind/cli/__tests__/orgrt/documents/writer-paths.test.ts
// P4.2: the lexical path arithmetic of the writer core: coverage of a role's own scope by a `writes` glob,
// workspace-relative path checks, the workspace as a sandbox entry, and the undecidable cases.
import { describe, expect, it } from 'vitest';
import {
  allowReachesWorkspace,
  covers,
  denyCoversWorkspace,
  fileScopeReachesWorkspace,
  literalBase,
  norm,
  overlaps,
  pathInScope,
  scopeCovers,
  workspaceInfo,
} from '../../../src/orgrt/documents/writer-paths.js';

describe('norm', () => {
  const cases: [string, string][] = [
    ['', '.'],
    ['./', '.'],
    ['.', '.'],
    ['./src/', 'src'],
    ['a//b/./c', 'a/b/c'],
    ['a/b/..', 'a'],
    ['../x', '../x'],
    ['/p/', '/p'],
    ['/', '/'],
  ];
  for (const [i, o] of cases) it(`${JSON.stringify(i)} -> ${o}`, () => expect(norm(i)).toBe(o));
});

describe('covers and overlaps', () => {
  const cases: [string, string, string | undefined, boolean | undefined, boolean | undefined][] = [
    // a, b, orgRoot, covers(a,b), overlaps(a,b)
    ['.', '.', undefined, true, true],
    ['.', 'src', undefined, true, true],
    ['src', '.', undefined, false, true],
    ['src', 'src/a', undefined, true, true],
    ['src', 'src-old', undefined, false, false],
    ['..', '.', undefined, true, true],
    ['../..', '..', undefined, true, true],
    ['../x', '.', undefined, false, false],
    ['/p', '/p/q', undefined, true, true],
    ['/p', '/pq', undefined, false, false],
    ['/', '/p', undefined, true, true],
    ['/p', '.', undefined, undefined, undefined],
    ['.', '/p', undefined, undefined, undefined],
    ['.', '/p', '/p', true, true],
    ['sub', '/p/sub/x', '/p', true, true],
    ['~/x', '.', undefined, undefined, undefined],
    ['$HOME', '.', '/p', undefined, undefined],
    ['/tmp/scratch', '.', '/p', false, false],
  ];
  for (const [a, b, root, c, o] of cases)
    it(`${a} vs ${b}${root ? ` (org root ${root})` : ''}: covers ${c}, overlaps ${o}`, () => {
      expect(covers(a, b, root)).toBe(c);
      expect(overlaps(a, b, root)).toBe(o);
    });
});

describe('literalBase', () => {
  const cases: [string, string][] = [
    ['src/**', 'src'],
    ['src/app/*.ts', 'src/app'],
    ['**', '.'],
    ['**/*.md', '.'],
    ['docs', 'docs'],
    ['/tmp/out/**', '/tmp/out'],
    ['/**', '/'],
  ];
  for (const [i, o] of cases) it(`${i} -> ${o}`, () => expect(literalBase(i)).toBe(o));
});

describe('scopeCovers: does a writes entry cover everything an own entry can name', () => {
  const cases: [string, string, boolean][] = [
    ['src/**', 'src/**', true],
    ['**', 'anything/at/all', true],
    ['src/**', 'src/app/**', true],
    ['src/**', 'src/app', true],
    ['src/**', 'src/app/a.ts', true],
    ['src/**', 'src', true],
    ['src/**', 'srcx/**', false],
    ['src/**', 'lib/**', false],
    ['src/**', '**', false],
    ['src/**', '../src/a', false],
    ['src/**', '/src/a', false],
    ['src/*.ts', 'src/*.ts', true],
    ['src/*.ts', 'src/a.ts', false],
    ['src/*', 'src/*', true],
    ['src/*', 'src/a/**', false],
    ['**/*.md', 'docs/*.md', true],
    ['**/*.md', 'docs/**', false],
    ['docs', 'docs/guide/**', true],
    ['docs', 'docs/a.md', true],
    ['docs', 'docs', true],
    ['docs', 'docs-old', false],
    ['docs', '**', false],
    ['/abs/out/**', '/abs/out/x/**', true],
    ['/abs/out/**', 'out/x', false],
  ];
  for (const [w, e, ok] of cases) it(`${w} covers ${e}: ${ok}`, () => expect(scopeCovers(w, e)).toBe(ok));
});

describe('pathInScope', () => {
  const scope = ['src/**', 'docs', 'README.md'];
  const cases: [string, boolean][] = [
    ['src/a.ts', true],
    ['src/a/b/c.ts', true],
    ['./src/a.ts', true],
    ['src', false],
    ['docs', true],
    ['docs/x/y.md', true],
    ['README.md', true],
    ['README.md.bak', false],
    ['lib/a.ts', false],
    ['../src/a.ts', false],
    ['/src/a.ts', false],
    ['src/../lib/a.ts', false],
    ['src/../src/a.ts', true],
  ];
  for (const [p, ok] of cases) it(`${p}: ${ok}`, () => expect(pathInScope(scope, p)).toBe(ok));
  it('an empty scope allows nothing', () => expect(pathInScope([], 'src/a.ts')).toBe(false));
});

describe('workspaceInfo', () => {
  const info = (workspace: unknown, name: string | null = 'org', role?: string) =>
    workspaceInfo({ name: name ?? undefined, run_config: workspace === undefined ? {} : { workspace } }, role);

  it('repo is the default and is the project root', () => {
    expect(info(undefined)).toEqual({ mode: 'repo', key: 'repo', entry: '.', shared: true });
    expect(info('')).toMatchObject({ mode: 'repo' });
    expect(workspaceInfo({})).toMatchObject({ mode: 'repo', entry: '.' });
  });
  it('isolated and worktree are directories under the org', () => {
    expect(info('isolated')).toMatchObject({ key: 'isolated', entry: '.monomind/orgs/org/workspace' });
    expect(info('worktree')).toMatchObject({ key: 'worktree', entry: '.monomind/orgs/org/worktree' });
  });
  it('without an org name they fall back to the org root, the safe side for a deny', () => {
    expect(info('isolated', null).entry).toBe('.');
    expect(info('worktree', null).entry).toBe('.');
  });
  it('worktree-per-role gives each role its own key and is not shared', () => {
    expect(info('worktree-per-role', 'org', 'qa')).toEqual({
      mode: 'worktree-per-role',
      key: 'worktree-per-role:qa',
      entry: '.monomind/orgs/org/worktree-qa',
      shared: false,
    });
  });
  it('a path is used as given, normalised', () => {
    expect(info('/work/./proj/')).toEqual({ mode: 'path', key: 'path:/work/proj', entry: '/work/proj', shared: true });
    expect(info('out/ws')).toMatchObject({ key: 'path:out/ws', entry: 'out/ws' });
  });
});

describe('what reaches the workspace', () => {
  const repo = workspaceInfo({});
  const abs = workspaceInfo({ run_config: { workspace: '/ws' } });
  const iso = workspaceInfo({ name: 'org', run_config: { workspace: 'isolated' } });

  it('a deny covers the workspace when it is the workspace or an ancestor', () => {
    expect(denyCoversWorkspace('.', repo)).toBe(true);
    expect(denyCoversWorkspace('src', repo)).toBe(false);
    expect(denyCoversWorkspace('.', iso)).toBe(true);
    expect(denyCoversWorkspace('.monomind/orgs', iso)).toBe(true);
    expect(denyCoversWorkspace('.monomind/orgs/org/workspace', iso)).toBe(true);
    expect(denyCoversWorkspace('.monomind/orgs/other', iso)).toBe(false);
    expect(denyCoversWorkspace('/ws', abs)).toBe(true);
    expect(denyCoversWorkspace('/', abs)).toBe(true);
    expect(denyCoversWorkspace('/ws/sub', abs)).toBe(false);
  });

  it('a relative deny against an absolute workspace is undecidable, so it does not cover, unless the org root is known', () => {
    expect(denyCoversWorkspace('.', abs)).toBe(false);
    expect(denyCoversWorkspace('.', abs, '/ws')).toBe(true);
    expect(denyCoversWorkspace('.', abs, '/elsewhere')).toBe(false);
  });

  it('an allowWrite reaches the workspace when it overlaps it from either side; an unrelated path does not', () => {
    expect(allowReachesWorkspace('.', repo)).toBe(true);
    expect(allowReachesWorkspace('src/gen', repo)).toBe(true);
    expect(allowReachesWorkspace('/tmp/scratch', repo)).toBe(false);
    expect(allowReachesWorkspace('.monomind/orgs/org', iso)).toBe(true);
    expect(allowReachesWorkspace('src', iso)).toBe(false);
    expect(allowReachesWorkspace('/ws/out', abs)).toBe(true);
    expect(allowReachesWorkspace('/', abs)).toBe(true);
    expect(allowReachesWorkspace('/tmp', abs)).toBe(false);
    expect(allowReachesWorkspace('~', repo)).toBe(false);
  });

  it('a relative fileWrite entry is relative to the workspace and always reaches it; an absolute one only when it overlaps', () => {
    expect(fileScopeReachesWorkspace('docs/**', repo)).toBe(true);
    expect(fileScopeReachesWorkspace('docs/**', abs)).toBe(true);
    expect(fileScopeReachesWorkspace('../out/**', repo)).toBe(false);
    expect(fileScopeReachesWorkspace('/tmp/out/**', repo)).toBe(false);
    expect(fileScopeReachesWorkspace('/ws/src/**', abs)).toBe(true);
    expect(fileScopeReachesWorkspace('/tmp/**', abs)).toBe(false);
    expect(fileScopeReachesWorkspace('/p/**', repo, '/p')).toBe(true);
  });
});
