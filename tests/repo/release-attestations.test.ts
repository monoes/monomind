/**
 * Publish guard (#797): a released package that is on npm must carry
 * dist.attestations (npm provenance), else it was published outside the
 * tag-triggered release workflow. The registry lookup is injected.
 */
import { describe, expect, it } from 'vitest';
import {
  findMissingAttestations,
  // @ts-expect-error plain .mjs script without types
} from '../../scripts/check-release-attestations.mjs';
import {
  CHECKS,
  // @ts-expect-error plain .mjs script without types
} from '../../scripts/check-versions.mjs';

const releaseSet = [
  { name: 'monomind', version: '2.30.0' },
  { name: '@monoes/monomindcli', version: '2.30.0' },
];
const attested = { attestations: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/x' } };

describe('findMissingAttestations', () => {
  it('flags a published package with no dist.attestations, naming it', () => {
    const problems = findMissingAttestations({
      releaseSet,
      getDist: (name: string) => (name === 'monomind' ? {} : attested),
    });
    expect(problems).toEqual([{ name: 'monomind', version: '2.30.0' }]);
  });

  it('passes when every published package is attested', () => {
    expect(findMissingAttestations({ releaseSet, getDist: () => attested })).toEqual([]);
  });

  it('skips packages not on npm yet (the check can run before the publish)', () => {
    expect(findMissingAttestations({ releaseSet, getDist: () => null })).toEqual([]);
  });
});

describe('check-versions', () => {
  it('runs the attestation check and treats it as a registry check', () => {
    const c = CHECKS.find((x: { script: string }) => x.script === 'check-release-attestations.mjs');
    expect(c?.registry).toBe(true);
  });
});
