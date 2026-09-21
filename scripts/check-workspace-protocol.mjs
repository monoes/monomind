#!/usr/bin/env node
/**
 * Publish guard: a dependency on a sibling workspace package must use the
 * `workspace:` protocol, never a registry range.
 *
 * ## The failure this pins
 *
 * check-package-bumps.mjs and check-published-pins.mjs are a matched pair, and
 * both rest on a single premise, stated in the first of them: "every sibling
 * package is pinned as `workspace:*`, which pnpm rewrites at pack time to the
 * version that package currently declares." That premise is what makes a
 * missing bump visible (the pin would resolve to the tarball already on npm)
 * and a stranded bump visible (the pin would name a version that is not on npm
 * at all).
 *
 * A sibling pinned by registry range instead — `"@monoes/monobrowse": "^1.0.6"`
 * — silently opts out of both guards. pnpm leaves a plain range alone at pack
 * time, so the published package resolves whatever the registry currently
 * offers and the workspace copy never reaches a consumer. Neither guard can
 * see it: check-package-bumps asks only whether the version was bumped, which
 * it may well have been, and check-published-pins iterates `workspace:` pins,
 * which this is not. The hole is invisible precisely because both guards stay
 * green.
 *
 * Found live on 2026-09-21, after 2.14.0 had shipped with every guard green:
 * `@monoes/monodesign` was 1.2.10 in the workspace and 1.2.9 on npm, while the
 * CLI's `^1.2.2` resolved to the published 1.2.9. Four other edges were in the
 * same state. That particular delta was one test file, so nothing shipped
 * wrong — but it is the exact shape of the 2.11.4 monograph incident, and the
 * only reason it was harmless is luck about which file changed.
 *
 * ## Why optional dependencies count
 *
 * An optional sibling goes stale exactly like a required one; "optional" says
 * installation may fail, not that the version may be wrong. They are checked.
 *
 * ## Why a private sibling does not count
 *
 * A private package is never published, so a consumer cannot resolve it from
 * the registry at all and there is no old tarball for a range to fall back to.
 *
 * ## Escape hatch
 *
 * MONOMIND_ALLOW_REGISTRY_SIBLINGS=1 skips the check. Prefer fixing the edge:
 * the whole point is that the other two guards cannot cover what this one
 * waives.
 *
 * Usage: check-workspace-protocol.mjs [repoRoot]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const repoRoot = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every manifest in the workspace: the umbrella at the root, plus
 *  packages/<name>/ and packages/<scope>/<name>/. Found rather than listed, so
 *  a package added tomorrow is covered the day it lands. */
function manifests() {
  const found = [];
  const push = (dir) => {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) return;
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (pkg.name) found.push({ ...pkg, dir: relative(repoRoot, dir) || '.' });
    } catch {
      // An unparseable manifest is not this guard's business to report.
    }
  };

  push(repoRoot);

  const packages = join(repoRoot, 'packages');
  if (!existsSync(packages)) return found;
  for (const scope of readdirSync(packages, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const scopeDir = join(packages, scope.name);
    if (existsSync(join(scopeDir, 'package.json'))) {
      push(scopeDir);
      continue;
    }
    for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
      if (entry.isDirectory()) push(join(scopeDir, entry.name));
    }
  }
  return found;
}

if (process.env.MONOMIND_ALLOW_REGISTRY_SIBLINGS === '1') {
  console.log('✓ workspace-protocol check skipped (MONOMIND_ALLOW_REGISTRY_SIBLINGS=1)');
  process.exit(0);
}

const all = manifests();
/** Only publishable siblings: a private package has no tarball to go stale. */
const siblings = new Map(all.filter((p) => !p.private && p.version).map((p) => [p.name, p]));

const violations = [];
for (const pkg of all) {
  for (const field of DEP_FIELDS) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      if (!siblings.has(dep)) continue;
      if (typeof range === 'string' && range.startsWith('workspace:')) continue;
      violations.push({
        from: pkg.name,
        dir: pkg.dir,
        field,
        dep,
        range,
        sibling: siblings.get(dep),
      });
    }
  }
}

if (violations.length) {
  console.error(
    '\n✗ publish blocked: a sibling workspace package is depended on by registry range\n',
  );
  for (const v of violations) {
    console.error(
      `    ${v.from} -> ${v.dep} = ${JSON.stringify(v.range)}   (${v.field} in ${v.dir}/package.json)`,
    );
    console.error(
      `        the workspace copy is ${v.sibling.version}; the range resolves to whatever npm serves,\n` +
        `        so changes to ${v.dep} in this repository never reach a consumer of ${v.from}.`,
    );
  }
  console.error(
    "\n  pnpm rewrites a workspace: pin to the sibling's declared version at pack time, which is\n" +
      '  what lets check-package-bumps see a missing bump and check-published-pins see a stranded\n' +
      '  one. A plain range is left alone and is invisible to both — the 2.11.4 failure mode, with\n' +
      '  every other guard green.\n\n' +
      '  Fix: depend on the sibling as "workspace:*", then publish it before the package that\n' +
      '  consumes it (check-published-pins will tell you if it is not on npm yet).\n' +
      '  If an edge is deliberate, set MONOMIND_ALLOW_REGISTRY_SIBLINGS=1.\n',
  );
  process.exit(1);
}

console.log(
  `✓ workspace-protocol check ok — every sibling dependency uses workspace: (${siblings.size} publishable packages)`,
);
