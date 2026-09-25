#!/usr/bin/env node
/**
 * Assert the @monoes/monomindcli package ships the skills `monomind init`
 * installs.
 *
 * 2.16.2–2.16.4 shipped without the monodesign skill: its directory in the
 * package tree is gitignored and compiled by
 * packages/@monoes/monodesign/scripts/sync-skill.mjs, so it shipped only when
 * the publishing checkout had compiled it. The CLI's `prepack` now compiles
 * it; this check makes a pack without it (or without any SKILLS_MAP skill)
 * fail loudly instead of publishing.
 *
 * Usage:
 *   node scripts/check-cli-pack.mjs <package-dir>   # npm pack --dry-run listing
 *   node scripts/check-cli-pack.mjs <tarball.tgz>   # an already-packed tarball
 *
 * SKILLS_MAP is read from the built CLI (packages/@monomind/cli/dist).
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(REPO_ROOT, 'packages/@monomind/cli/dist/src/init/shared.js');

/** Package-relative SKILL.md paths that must ship: monodesign plus every named SKILLS_MAP skill. */
export function requiredPackFiles(skillsMap) {
  const names = new Set(['monodesign']);
  for (const list of Object.values(skillsMap)) {
    for (const name of list) if (!name.includes('*')) names.add(name);
  }
  return [...names].sort().map((name) => `.claude/skills/${name}/SKILL.md`);
}

/** Required paths absent from a pack listing (tarball entries carry a `package/` prefix). */
export function missingFromPack(files, required) {
  const present = new Set(files.map((f) => f.replace(/^package\//, '')));
  return required.filter((rel) => !present.has(rel));
}

/** File list of a package directory (as npm would pack it) or of a tarball. */
function packFileList(target) {
  if (target.endsWith('.tgz')) {
    return execFileSync('tar', ['-tzf', target], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\n')
      .filter(Boolean);
  }
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: target,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].files.map((f) => f.path);
}

async function main(argv) {
  const target = resolve(argv[0] ?? join(REPO_ROOT, 'packages/@monomind/cli'));
  if (!existsSync(SHARED)) {
    console.error(`❌ ${SHARED} is missing — build the CLI first (pnpm -r run build).`);
    return 1;
  }
  const { SKILLS_MAP } = await import(pathToFileURL(SHARED).href);
  const required = requiredPackFiles(SKILLS_MAP);
  const missing = missingFromPack(packFileList(target), required);
  if (missing.length > 0) {
    console.error(`❌ ${target} would ship without ${missing.length} required file(s):`);
    for (const rel of missing) console.error(`    ${rel}`);
    console.error(
      '   monodesign is compiled by `node packages/@monoes/monodesign/scripts/sync-skill.mjs` ' +
        "(the CLI's prepack); other skills come from packages/@monomind/cli/.claude/skills.",
    );
    return 1;
  }
  console.log(`✓ ${target} ships all ${required.length} required skill files.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
