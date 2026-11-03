#!/usr/bin/env node
/**
 * Single entry point for the five version-policy checks, with one summary.
 *
 *   node scripts/check-versions.mjs [--no-registry]
 *
 * Runs, in order: check-publish-versions, check-package-bumps,
 * check-workspace-protocol, check-overrides-source, check-published-pins.
 * Every check runs even if an earlier one fails, so one pass reports all the
 * problems. Each script still works alone (and `prepublishOnly` still calls
 * them directly). Exits 1 if any check failed.
 *
 * check-published-pins asks the npm registry whether the root's pinned
 * siblings exist. --no-registry (or MONOMIND_CHECK_VERSIONS_OFFLINE=1) skips it.
 * See doc/publishing.md ("Version policy").
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const offline =
  process.argv.includes('--no-registry') || process.env.MONOMIND_CHECK_VERSIONS_OFFLINE === '1';

export const CHECKS = [
  {
    script: 'check-publish-versions.mjs',
    what: 'umbrella and CLI versions agree, pin is workspace:*',
  },
  { script: 'check-package-bumps.mjs', what: 'changed packages are bumped, no unearned major' },
  { script: 'check-workspace-protocol.mjs', what: 'internal deps use workspace:*' },
  { script: 'check-overrides-source.mjs', what: 'overrides come from the right source' },
  {
    script: 'check-published-pins.mjs',
    args: ['.'],
    what: 'pinned siblings exist on npm',
    registry: true,
  },
];

function main() {
  const rows = [];
  for (const check of CHECKS) {
    if (check.registry && offline) {
      rows.push({ ...check, status: 'SKIP' });
      continue;
    }
    console.log(`\n=== ${check.script} ===`);
    const res = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts', check.script), ...(check.args ?? [])],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      },
    );
    rows.push({ ...check, status: res.status === 0 ? 'PASS' : 'FAIL' });
  }

  console.log('\n=== version checks summary ===');
  for (const r of rows) console.log(`  ${r.status.padEnd(4)}  ${r.script}  (${r.what})`);
  const failed = rows.filter((r) => r.status === 'FAIL');
  console.log(
    failed.length
      ? `\n✗ ${failed.length} of ${rows.length} checks failed`
      : '\n✓ all version checks passed',
  );
  process.exit(failed.length ? 1 : 0);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
