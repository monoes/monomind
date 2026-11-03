#!/usr/bin/env node
/**
 * Fails on a NEW `.skip` / `.todo` / `.skipIf` in test files that has no
 * justification comment.
 *
 * A skip is justified when its line, or the line directly above it, carries a
 * comment containing an issue reference (`#123`, `GH-123`) or `reason:`.
 * Skips that predate this check are baselined in check-skips.allowlist.json as
 * { "<file>": <count of unjustified skips> }; a file may not exceed its count.
 * Fixing or justifying an old skip never fails the check — lower its count.
 *
 * Usage: node scripts/ci/check-skips.mjs [--update]
 *   --update  rewrite the allowlist from the current tree (review the diff!).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const allowlistPath = join(dirname(fileURLToPath(import.meta.url)), 'check-skips.allowlist.json');

const TEST_FILE = /(^tests\/|(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$)/;
const SKIP = /\b(?:it|test|describe|suite)\.(?:skip|todo|skipIf)\b|\b(?:xit|xtest|xdescribe)\(/;
const JUSTIFIED = /\/\/.*(?:#\d+|GH-\d+|reason:)|\/\*.*(?:#\d+|GH-\d+|reason:)/i;

const files = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 << 20,
})
  .split('\0')
  .filter((f) => TEST_FILE.test(f) && /\.[cm]?[jt]sx?$/.test(f));

const found = {};
for (const file of files) {
  let lines;
  try {
    lines = readFileSync(join(root, file), 'utf8').split('\n');
  } catch {
    continue; // listed by git but absent from the working tree
  }
  lines.forEach((line, i) => {
    if (!SKIP.test(line)) return;
    if (JUSTIFIED.test(line) || (i > 0 && JUSTIFIED.test(lines[i - 1]))) return;
    (found[file] ??= []).push(i + 1);
  });
}

if (process.argv.includes('--update')) {
  const counts = Object.fromEntries(
    Object.entries(found)
      .sort()
      .map(([f, l]) => [f, l.length]),
  );
  writeFileSync(allowlistPath, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`allowlist rewritten: ${Object.keys(counts).length} files`);
  process.exit(0);
}

const allow = JSON.parse(readFileSync(allowlistPath, 'utf8'));
let failed = false;
for (const [file, lineNos] of Object.entries(found)) {
  if (lineNos.length <= (allow[file] ?? 0)) continue;
  failed = true;
  console.error(
    `${file}: ${lineNos.length} unjustified skip(s), baseline ${allow[file] ?? 0} (lines ${lineNos.join(', ')})`,
  );
}
if (failed) {
  console.error(
    '\nAdd a comment with an issue reference (#123) or `reason: ...` on the skip line or the line above it.',
  );
  process.exit(1);
}
console.log(`skip check ok — ${Object.values(found).flat().length} baselined unjustified skip(s)`);
