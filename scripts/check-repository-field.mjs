#!/usr/bin/env node
/**
 * Publish guard: every publishable package must declare
 * `repository.url` equal to this GitHub repository.
 *
 * Provenance (npm publish --provenance, #797) rejects a package whose
 * package.json repository.url is empty or does not match the repository the
 * workflow runs in (E422). 2.29.5 failed this way for @monoes/mcp, memory,
 * monograph and routing, after the tag and main were already public. Nothing
 * else notices before a publish, so check it statically.
 *
 * Usage: check-repository-field.mjs [repoRoot]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED = 'https://github.com/monoes/monomind.git';
const repoRoot = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');

const found = [];
const push = (dir) => {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return;
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (pkg.name && !pkg.private) found.push({ pkg, dir: relative(repoRoot, dir) || '.' });
  } catch {
    // An unparseable manifest is not this guard's business.
  }
};
push(repoRoot);
const packages = join(repoRoot, 'packages');
if (existsSync(packages)) {
  for (const a of readdirSync(packages, { withFileTypes: true })) {
    if (!a.isDirectory()) continue;
    if (a.name.startsWith('@')) {
      for (const b of readdirSync(join(packages, a.name), { withFileTypes: true })) {
        if (b.isDirectory()) push(join(packages, a.name, b.name));
      }
    } else push(join(packages, a.name));
  }
}

const normalize = (u) => String(u ?? '').replace(/^git\+/, '');
const problems = [];
for (const { pkg, dir } of found) {
  const repo = pkg.repository;
  const url = typeof repo === 'string' ? repo : repo?.url;
  if (normalize(url) !== EXPECTED) {
    problems.push(
      `${pkg.name} (${dir}): repository.url is ${JSON.stringify(url ?? null)}, expected git+${EXPECTED}`,
    );
    continue;
  }
  if (dir !== '.' && (typeof repo === 'string' || repo.directory !== dir.split('\\').join('/'))) {
    problems.push(`${pkg.name} (${dir}): repository.directory should be ${JSON.stringify(dir)}`);
  }
}

if (problems.length) {
  console.error(
    'check-repository-field: npm provenance rejects packages whose repository.url does not match the GitHub repo (E422):',
  );
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `check-repository-field: ${found.length} publishable packages declare repository.url ${EXPECTED}`,
);
