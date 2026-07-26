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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(repoRoot, p), 'utf8'));

const root = read('package.json');
const cli = read('packages/@monomind/cli/package.json');
const pin = root.dependencies?.['@monoes/monomindcli'];

const problems = [];
if (!pin) {
  problems.push('root package.json is missing the @monoes/monomindcli dependency');
} else if (pin !== cli.version) {
  problems.push(`pin mismatch: root depends on @monoes/monomindcli@${pin}, but the CLI package is ${cli.version}`);
}
if (root.version !== cli.version) {
  problems.push(`version mismatch: monomind is ${root.version}, @monoes/monomindcli is ${cli.version}`);
}

if (problems.length) {
  console.error('\nāœ— publish blocked — umbrella/CLI versions disagree:\n');
  for (const p of problems) console.error(`    ${p}`);
  console.error(
    `\n  Fix: set all three to the same version.\n` +
      `    package.json                        -> "version": "X.Y.Z"\n` +
      `    package.json                        -> "@monoes/monomindcli": "X.Y.Z"\n` +
      `    packages/@monomind/cli/package.json -> "version": "X.Y.Z"\n`,
  );
  process.exit(1);
}

console.log(`āœ“ version parity ok — monomind ${root.version} pins @monoes/monomindcli ${cli.version}`);
