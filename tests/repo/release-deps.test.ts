/**
 * Publish guard (#780): a released package's workspace deps must be on npm or
 * in the release set. The registry lookup is injected, so this runs offline.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { findUnpublishedDeps } from '../../scripts/check-release-deps.mjs';

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
