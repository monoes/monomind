/**
 * Publish guard (#780): a released package's workspace deps must be on npm or
 * in the release set. The registry lookup is injected, so this runs offline.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  claudeSdkPin,
  findClaudeSdkProblem,
  findUnpublishedDeps,
  // @ts-expect-error plain .mjs script without types
} from '../../scripts/check-release-deps.mjs';

const workspace = new Map([
  ['cli', { name: 'cli', version: '2.29.3', deps: ['hooks', 'routing'] }],
  ['hooks', { name: 'hooks', version: '2.24.2', deps: [] }],
  ['routing', { name: 'routing', version: '2.24.2', deps: [] }],
]);
const cli = { name: 'cli', version: '2.29.3' };

describe('findUnpublishedDeps', () => {
  it('flags deps that are neither on npm nor in the release set, naming package, dep and version', () => {
    const problems = findUnpublishedDeps({
      workspace,
      releaseSet: [cli],
      isOnNpm: () => false,
    });
    expect(problems).toEqual([
      { pkg: 'cli', dep: 'hooks', version: '2.24.2' },
      { pkg: 'cli', dep: 'routing', version: '2.24.2' },
    ]);
  });

  it('accepts deps released in the same run without asking npm', () => {
    const problems = findUnpublishedDeps({
      workspace,
      releaseSet: [
        cli,
        { name: 'hooks', version: '2.24.2' },
        { name: 'routing', version: '2.24.2' },
      ],
      isOnNpm: () => {
        throw new Error('should not query npm');
      },
    });
    expect(problems).toEqual([]);
  });

  it('accepts deps whose version is on npm', () => {
    const problems = findUnpublishedDeps({
      workspace,
      releaseSet: [cli],
      isOnNpm: (name: string) => name !== 'routing',
    });
    expect(problems).toEqual([{ pkg: 'cli', dep: 'routing', version: '2.24.2' }]);
  });

  it('does not treat a different version in the release set as covering the dep', () => {
    const problems = findUnpublishedDeps({
      workspace,
      releaseSet: [cli, { name: 'hooks', version: '2.24.0' }],
      isOnNpm: () => false,
    });
    expect(problems.map((p: { dep: string }) => p.dep)).toContain('hooks');
  });
});

describe('findClaudeSdkProblem (#789)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tempHome = () => {
    const d = mkdtempSync(join(tmpdir(), 'release-deps-home-'));
    dirs.push(d);
    return d;
  };
  const install = (deps: string, version: string, pkgVersion = version) => {
    const dir = join(
      deps,
      `@anthropic-ai+claude-agent-sdk@${version}`,
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk',
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: pkgVersion }));
  };

  it('reads the pin from the CLI manifest', () => {
    expect(claudeSdkPin()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('passes when MONOMIND_HOME/deps holds the pinned version', () => {
    const mh = tempHome();
    install(join(mh, 'deps'), '0.3.319');
    expect(
      findClaudeSdkProblem({ pin: '0.3.319', env: { MONOMIND_HOME: mh }, home: '/nonexistent' }),
    ).toBeNull();
  });

  it('defaults to <home>/.monomind/deps and names the older versions it found', () => {
    const home = tempHome();
    install(join(home, '.monomind', 'deps'), '0.3.303');
    const problem = findClaudeSdkProblem({ pin: '0.3.319', env: {}, home });
    expect(problem).toContain(join(home, '.monomind', 'deps'));
    expect(problem).toContain('found only 0.3.303');
    expect(problem).toContain('monomind deps install');
  });

  it('does not count a directory whose package.json carries another version', () => {
    const mh = tempHome();
    install(join(mh, 'deps'), '0.3.319', '0.3.1');
    expect(findClaudeSdkProblem({ pin: '0.3.319', env: { MONOMIND_HOME: mh } })).toMatch(
      /not installed/,
    );
  });
});
