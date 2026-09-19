#!/usr/bin/env node
/**
 * Publish guard: every `workspace:*` pin must resolve to a version that is
 * actually ON npm, or the published tarball is uninstallable.
 *
 * ## The failure this pins
 *
 * 2.11.10 and 2.11.11 both shipped depending on `@monoes/monograph@1.6.6`,
 * a version that did not exist on the registry. monograph had been bumped
 * 1.6.5 -> 1.6.6 in the repo for the #298 hooksPath fix but never published:
 * the agent org that made the change has no publish rights, and nothing
 * downstream noticed.
 *
 * Every consumer install of both releases died at resolution:
 *
 *     npm error notarget No matching version found for @monoes/monograph@1.6.6
 *
 * Nothing caught it. `pnpm publish` rewrites `workspace:*` to whatever the
 * sibling currently declares and never asks whether that version is public.
 * check-publish-versions.mjs only agrees three numbers match. And
 * check-package-bumps.mjs is the exact mirror of this check — it proves a
 * changed package WAS bumped, and a bump is precisely what strands the pin
 * until someone publishes it. The two guards only work as a pair.
 *
 * So this runs against the registry and asks the one question that decides
 * whether the release installs: does the thing this tarball points at exist?
 *
 * ## Ordering
 *
 * Siblings must be published BEFORE their dependents — monograph, then the
 * CLI, then the umbrella. That is not a new constraint; it is the constraint
 * that was already true and silently unenforced. Failing here says the order
 * was wrong, not that the version is.
 *
 * ## Scope
 *
 * Checks one package: the directory given as argv[2], else cwd. Deliberately
 * NOT all of them at once — while the CLI is publishing, the umbrella still
 * pins a CLI version that is seconds from existing, and a repo-wide sweep
 * would fail on it every time.
 *
 * ## Escape hatch
 *
 * MONOMIND_ALLOW_UNPUBLISHED_PINS=1 skips the check, for publishing into a
 * registry this cannot reach. Prefer fixing the order: an uninstallable
 * release costs a whole version number, as it cost two here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? process.cwd());

const MANIFEST_KEYS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/** Sleep without pulling in a timer — this script is entirely synchronous. */
const sleepSeconds = (s) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);

/** Every workspace package, by name: the version it declares (what pnpm
 *  rewrites a `workspace:*` pin to) and where it lives (for the fix hint). */
function workspacePackages() {
  const byName = new Map();
  const add = (dir) => {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) return;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (!pkg.name || !pkg.version) return;
    byName.set(pkg.name, {
      version: pkg.version,
      dir: dir === repoRoot ? '.' : dir.slice(repoRoot.length + 1),
    });
  };
  add(repoRoot);
  const scopes = join(repoRoot, 'packages');
  for (const scope of readdirSync(scopes, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const scopeDir = join(scopes, scope.name);
    if (existsSync(join(scopeDir, 'package.json'))) add(scopeDir);
    else
      for (const entry of readdirSync(scopeDir, { withFileTypes: true }))
        if (entry.isDirectory()) add(join(scopeDir, entry.name));
  }
  return byName;
}

/** npm's view of a package's versions: a Set, or null when the package is
 *  not on the registry at all, or `false` when the registry is unreachable. */
function fetchVersions(name) {
  try {
    const out = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(out);
    return new Set(Array.isArray(parsed) ? parsed : [parsed]);
  } catch (err) {
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (text.includes('E404') || text.includes('404 Not Found')) return null;
    return false;
  }
}

/**
 * Is name@version resolvable on npm?
 *
 * Retried on absence, not only on error: a version published seconds ago is
 * not visible yet, and `npm view` answers successfully with a list that does
 * not contain it.
 *
 * The budget is ~8.5 minutes, and it is set from measurement rather than
 * taste. The first version of this waited 90s, which looked generous and was
 * not: on its very first real run it blocked a correct 2.11.12 umbrella
 * publish, because the CLI it pins took 225s to become visible. That is the
 * failure mode this guard can least afford — one that fails correct releases
 * gets deleted, and then nothing catches the unresolvable pin it exists for.
 * So the ceiling sits well clear of the worst propagation actually seen here.
 *
 * Only genuine absence pays it. A package with no versions at all, or one
 * whose list already contains the version, is answered on the first call.
 */
function isPublished(name, version) {
  const backoff = [0, 5, 10, 15, 30, 30, 60, 60, 90, 90, 120];
  for (let i = 0; i < backoff.length; i++) {
    if (backoff[i]) sleepSeconds(backoff[i]);
    const versions = fetchVersions(name);
    if (versions === false) {
      if (i === backoff.length - 1) {
        console.error(`\n✗ publish blocked: could not reach the registry for ${name}\n`);
        console.error(
          '  Fix:\n    restore network access, or set MONOMIND_ALLOW_UNPUBLISHED_PINS=1\n',
        );
        process.exit(1);
      }
      continue;
    }
    if (versions?.has(version)) return true;
    if (i === 0 && versions !== null)
      console.log(
        `  … ${name}@${version} not on npm yet — waiting up to 8m in case it is still propagating`,
      );
  }
  return false;
}

const manifestPath = join(target, 'package.json');
if (!existsSync(manifestPath)) {
  console.error(`✗ published-pin check: no package.json at ${target}`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
const workspace = workspacePackages();

const pins = [];
for (const key of MANIFEST_KEYS) {
  for (const [name, spec] of Object.entries(pkg[key] ?? {})) {
    if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
    const found = workspace.get(name);
    if (!found) {
      console.error(`\n✗ publish blocked: ${pkg.name} pins ${name} as "${spec}",`);
      console.error('    but no workspace package declares that name — pnpm cannot rewrite it.\n');
      process.exit(1);
    }
    pins.push({ name, ...found });
  }
}

if (pins.length === 0) {
  console.log(`✓ published-pin check ok — ${pkg.name} has no workspace:* dependencies`);
  process.exit(0);
}

const label = pins.map((p) => `${p.name}@${p.version}`).join(', ');

if (process.env.MONOMIND_ALLOW_UNPUBLISHED_PINS === '1') {
  console.log(`✓ published-pin check skipped (MONOMIND_ALLOW_UNPUBLISHED_PINS=1) — ${label}`);
  process.exit(0);
}

const missing = pins.filter(({ name, version }) => !isPublished(name, version));

if (missing.length > 0) {
  console.error(`\n✗ publish blocked: ${pkg.name}@${pkg.version} would ship unresolvable pins\n`);
  for (const { name, version } of missing)
    console.error(
      `    ${name}@${version} — pnpm writes this into the tarball; npm cannot resolve it`,
    );
  console.error('\n  Every consumer install would fail at resolution:\n');
  console.error(
    `    npm error notarget No matching version found for ${missing[0].name}@${missing[0].version}\n`,
  );
  console.error('  Fix — publish the sibling first, then retry this publish:\n');
  for (const { name, version, dir } of missing)
    console.error(`    (cd ${dir} && pnpm publish --no-git-checks)   # ${name}@${version}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ published-pin check ok — ${label} resolvable on npm`);
