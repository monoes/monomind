#!/usr/bin/env node
/**
 * Publish guard: the `monomind` umbrella is a shim that pins the real CLI
 * exactly. Three numbers must agree or a release silently ships a stale CLI:
 *
 *   root package.json  version
 *   root package.json  dependencies["@monoes/monomindcli"]
 *   cli  package.json  version
 *
 * Runs from root prepublishOnly. Exits non-zero with the exact fix on drift.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(repoRoot, p), 'utf8'));

const root = read('package.json');
const cli = read('packages/@monomind/cli/package.json');
const pin = root.dependencies?.['@monoes/monomindcli'];

const problems = [];

// The pin uses pnpm's workspace protocol, which pnpm rewrites to the CLI's
// exact version as it builds the tarball. A hand-written literal version was
// the previous arrangement and had two failure modes:
//
//   1. it had to be bumped by hand in lockstep with two other numbers, and
//   2. pnpm resolved it from the REGISTRY rather than the workspace, so the
//      repo installed a published CLI instead of linking its own — and pushing
//      a version bump before publishing that version broke every CI job with
//      ERR_PNPM_NO_MATCHING_VERSION, because the pin did not exist on npm yet.
//
// workspace:* removes both: the local package is linked, and the published
// pin is generated from whatever the CLI's version actually is.
if (!pin) {
  problems.push('root package.json is missing the @monoes/monomindcli dependency');
} else if (!pin.startsWith('workspace:')) {
  problems.push(
    `the pin must use the workspace protocol, not a literal version (found "${pin}"). ` +
      'A literal pin makes pnpm fetch the CLI from npm instead of linking the local package.',
  );
}
if (root.version !== cli.version) {
  problems.push(
    `version mismatch: monomind is ${root.version}, @monoes/monomindcli is ${cli.version}`,
  );
}

// THE FOOTGUN THIS EXISTS TO STOP.
//
// `npm publish` does not understand the workspace protocol. It copies
// package.json verbatim, so publishing root with npm ships a tarball whose
// dependency is the literal string "workspace:*" — which no consumer can
// resolve. The package installs for nobody, and nothing about the publish
// looks wrong at the time. Verified by packing both ways: npm emits
// "workspace:*", pnpm emits the resolved version.
//
// Only the root package is affected; it is the only one using the protocol.
// Only while actually publishing. This script is also the documented
// pre-flight check (`npm run check:versions`), and gating that on the
// publisher made it exit 1 every time — telling someone merely verifying
// their versions to go use pnpm. npm sets npm_lifecycle_event to the script
// being run, so prepublishOnly is the one case that matters.
const publishing = process.env.npm_lifecycle_event === 'prepublishOnly';
const agent = process.env.npm_config_user_agent ?? '';
const viaPnpm = agent.includes('pnpm');
if (publishing && !viaPnpm && process.env.MONOMIND_ALLOW_NPM_PUBLISH !== '1') {
  problems.push(
    `this package must be published with \`pnpm publish\`, not npm (user agent: ${agent || 'unknown'}). ` +
      'npm copies "workspace:*" into the tarball verbatim and the published package becomes uninstallable.',
  );
}

// Real npm rejects an `overrides` entry for a package that is ALSO a direct
// (dependencies/devDependencies) entry of the SAME manifest, whenever the two
// version strings differ — "Override for X conflicts with direct dependency".
// pnpm does not enforce this, so `pnpm install`/`pnpm publish` stay silent
// and the break only surfaces for an end user running real npm against the
// published tarball (`npm install`, or `npx <pkg>`'s transient install) —
// exactly what happened with root's own "vitest": ">=4.1.11 <5" override
// against its "vitest": "^4.1.11" devDependency (semver-equivalent ranges,
// different strings — npm's check is string-based, not semver-based).
// Scoped to root and the CLI, the two packages this script already reads —
// the ones actually installed by real npm outside this workspace.
for (const [label, pkg] of [
  ['root package.json', root],
  ['cli package.json', cli],
]) {
  const overrides = pkg.overrides ?? {};
  const direct = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, overrideRange] of Object.entries(overrides)) {
    if (name in direct && direct[name] !== overrideRange) {
      problems.push(
        `${label}: "overrides" pins ${name}@${overrideRange} but a direct dependency ` +
          `wants ${name}@${direct[name]} — real npm rejects this (EOVERRIDE) even though ` +
          'pnpm does not. Make the two strings identical, or drop the override (a direct ' +
          'dependency already controls its own version; overrides are for transitive ones).',
      );
    }
  }
}

if (problems.length) {
  console.error('\n✗ publish blocked:\n');
  for (const p of problems) console.error(`    ${p}`);
  console.error(
    `\n  Fix:\n` +
      `    package.json                        -> "version": "X.Y.Z"\n` +
      `    packages/@monomind/cli/package.json -> "version": "X.Y.Z"\n` +
      `    package.json                        -> "@monoes/monomindcli": "workspace:*"  (do not hand-write a version)\n` +
      `    publish the CLI first, then run \`pnpm publish\` from the repo root\n`,
  );
  process.exit(1);
}

console.log(
  `✓ publish checks ok — monomind ${root.version} will pin @monoes/monomindcli ${cli.version} (from ${pin})`,
);
