#!/usr/bin/env node
/**
 * Fails when a test file gains a NEW hardcoded `/tmp` path literal.
 *
 * Tests that work in a literal '/tmp/...' path collide when suites run in
 * parallel, break on hosts with a per-user /tmp quota, and do not exist on
 * Windows. Use `mkdtempSync(join(tmpdir(), '<prefix>-'))` (node:fs/os/path)
 * and remove the directory in afterEach/afterAll instead.
 *
 * Literals that are test DATA (a fake cwd handed to a mocked runner, a path a
 * parser or validator is fed, a sandbox entry asserted on) never touch disk;
 * they are baselined in check-no-tmp-literals.allowlist.json as
 * { "<file>": { "count": <literals allowed>, "reason": "..." } }. A file may
 * not exceed its count. Removing a literal never fails the check — lower the
 * count.
 *
 * Usage: node scripts/ci/check-no-tmp-literals.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const allowlistPath = join(here, 'check-no-tmp-literals.allowlist.json');

const TEST_FILE =
  /(^tests\/|(^|\/)__tests__\/|^packages\/.+\/tests\/|\.(test|spec)\.[cm]?[jt]sx?$)/;
// A string or template literal that is, or starts with, the /tmp directory.
const TMP_LITERAL = /['"`]\/tmp(?=[/'"`])/g;

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
    const hits = line.match(TMP_LITERAL)?.length ?? 0;
    for (let n = 0; n < hits; n++) (found[file] ??= []).push(i + 1);
  });
}

const allow = JSON.parse(readFileSync(allowlistPath, 'utf8'));
let failed = false;
for (const [file, lineNos] of Object.entries(found)) {
  const baseline = allow[file]?.count ?? 0;
  if (lineNos.length <= baseline) continue;
  failed = true;
  console.error(
    `${file}: ${lineNos.length} hardcoded /tmp literal(s), baseline ${baseline} (lines ${[...new Set(lineNos)].join(', ')})`,
  );
}
if (failed) {
  console.error(
    "\nUse mkdtempSync(join(tmpdir(), '<prefix>-')) plus cleanup instead of a /tmp path. If the literal is test data that never touches disk, raise the file's count in scripts/ci/check-no-tmp-literals.allowlist.json and say why in its reason.",
  );
  process.exit(1);
}
console.log(
  `tmp literal check ok — ${Object.values(found).flat().length} baselined /tmp data literal(s)`,
);
