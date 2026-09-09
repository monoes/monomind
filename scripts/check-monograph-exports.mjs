#!/usr/bin/env node
/**
 * Publish guard for @monoes/monograph: verifies every name the CLI package
 * actually imports from this package (static and dynamic) is really present
 * in the built dist/src/index.js — not just that some build ran, but that
 * what a real consumer depends on survived it.
 *
 * Exists because of #232: @monoes/monograph@1.6.1 was published with a
 * dist/src/search/hybrid-query.js missing `searchGraph`, even though the
 * package's own `prebuild` script clears dist/ first — a clean rebuild from
 * the exact same source produces the correct file, so this checks the
 * actual packed artifact's behavior as a backstop regardless of how a stale
 * build slipped through (skipped build step, reused incremental cache,
 * publishing from a stale checkout, etc.).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', '@monomind', 'monograph');
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliSrc = join(repoRoot, 'packages', '@monomind', 'cli', 'src');

if (!existsSync(cliSrc)) {
  // Only meaningful inside the monomind monorepo checkout — a publish from
  // any other context (e.g. this package extracted/forked on its own) has no
  // CLI source to check against, so there's nothing this guard can verify.
  console.log('✓ publish checks skipped — no CLI source tree found (not running inside the monomind monorepo)');
  process.exit(0);
}

function walkSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE =
  /(?:import\s*\{([^}]+)\}\s*from\s*['"]@monoes\/monograph['"]|const\s*\{([^}]+)\}\s*=\s*await\s*import\(\s*['"]@monoes\/monograph['"]\s*\))/g;

const names = new Set();
for (const file of walkSourceFiles(cliSrc)) {
  const content = readFileSync(file, 'utf8');
  let match;
  while ((match = IMPORT_RE.exec(content))) {
    const group = match[1] ?? match[2];
    for (const rawPart of group.split(',')) {
      const part = rawPart.trim();
      if (!part || part.startsWith('type ') || part.startsWith('...')) continue;
      // Static `import { x as y }` renames with " as "; dynamic destructuring
      // `const { x: y }` renames with ":" — either way we want the name being
      // read FROM the module, not the local alias it's bound to.
      const original = part.split(/\s+as\s+|:/)[0].trim();
      if (original) names.add(original);
    }
  }
}

const entry = join(pkgRoot, 'dist', 'src', 'index.js');
const mod = await import(pathToFileURL(entry).href);

const missing = [...names].filter((name) => !(name in mod));

if (missing.length > 0) {
  console.error(
    `\n✗ publish blocked: dist/src/index.js is missing ${missing.length} name(s) the CLI actually imports:`,
  );
  for (const name of missing.sort()) console.error(`    - ${name}`);
  console.error(
    '\n  This usually means dist/ is stale — a build step was skipped, an incremental\n' +
      '  cache was reused, or this is publishing from a checkout where source changed\n' +
      '  after the last build. Fix:\n' +
      '    rm -rf dist tsconfig.tsbuildinfo && npm run build\n' +
      '  then retry the publish.\n',
  );
  process.exit(1);
}

console.log(`✓ publish checks ok — dist/src/index.js exports all ${names.size} name(s) the CLI depends on`);
