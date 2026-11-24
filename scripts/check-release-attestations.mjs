#!/usr/bin/env node
/**
 * Release guard: every package of the release that is on npm must carry
 * `dist.attestations` (npm provenance).
 *
 *   node scripts/check-release-attestations.mjs [--base <ref>]
 *
 * Why (#797): 2.29.3 and 2.29.4 were published from a machine minutes before
 * the tag-triggered workflow ran, so the workflow skipped them and neither has
 * provenance. Only .github/workflows/release.yml (id-token: write,
 * NPM_CONFIG_PROVENANCE) produces attestations, so a missing one means the
 * version was published by hand. Packages not on npm yet are skipped, so this
 * can run before the publish; the workflow runs it again after.
 *
 * Skipped when no release tag is reachable. MONOMIND_ALLOW_NO_ATTESTATIONS=1
 * skips it.
 */
import { execFileSync } from 'node:child_process';
import { changedPackages, previousTag } from './release-packages.mjs';

/**
 * Pure check. `releaseSet` is a list of {name, version}; `getDist(name,
 * version)` (injectable) returns the registry `dist` object, or null when the
 * version is not on npm. Returns the published packages lacking attestations.
 */
export function findMissingAttestations({ releaseSet, getDist }) {
  const problems = [];
  for (const { name, version } of releaseSet) {
    const dist = getDist(name, version);
    if (dist && !dist.attestations) problems.push({ name, version });
  }
  return problems;
}

/** The registry `dist` of name@version, null on 404; throws if unreachable. */
function npmDist(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'dist', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim() ? JSON.parse(out) : {};
  } catch (err) {
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (text.includes('E404') || text.includes('404')) return null;
    throw new Error(`could not reach the npm registry for ${name}@${version}`);
  }
}

function main() {
  if (process.env.MONOMIND_ALLOW_NO_ATTESTATIONS === '1') {
    console.log('✓ attestation check skipped (MONOMIND_ALLOW_NO_ATTESTATIONS=1)');
    return;
  }
  const i = process.argv.indexOf('--base');
  const base = i > -1 ? process.argv[i + 1] : previousTag();
  if (!base) {
    console.log('✓ attestation check skipped — no previous v* release tag is reachable');
    return;
  }
  const releaseSet = changedPackages(base);
  const problems = findMissingAttestations({ releaseSet, getDist: npmDist });
  if (problems.length) {
    console.error('\n✗ published without npm provenance (no dist.attestations)\n');
    for (const p of problems) console.error(`    ${p.name}@${p.version}`);
    console.error(
      '\n  Only the tag-triggered release workflow publishes with provenance; never run' +
        '\n  `npm publish` or `pnpm publish` by hand (#797). See doc/publishing.md.\n',
    );
    process.exit(1);
  }
  console.log(`✓ attestation check ok — ${releaseSet.length} package(s) in the release set`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`✗ attestation check: ${err.message}`);
    process.exit(1);
  }
}
