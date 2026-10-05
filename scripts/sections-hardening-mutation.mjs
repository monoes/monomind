#!/usr/bin/env node
/**
 * GA row R7 (org sections spec 9.3): the mutation check of the release-build guards.
 *
 * For each entry of scripts/sections-hardening-mutations.mjs this weakens one guard in
 * the source, runs the probe suite (packages/@monomind/cli/__tests__/orgrt/documents/
 * hardening-probes.test.ts) and requires it to FAIL, then restores the file byte for
 * byte. A mutant the probes do not kill means a guard can be weakened without any test
 * noticing: the script exits 1 and names it.
 *
 * Usage: node scripts/sections-hardening-mutation.mjs [--row R4] [--list]
 * Run it in a worktree of your own; it edits tracked files in place and restores them
 * (also on SIGINT/SIGTERM). It never stashes and never touches git.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTATIONS, ORGRT } from './sections-hardening-mutations.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'packages/@monomind/cli');
const PROBES = '__tests__/orgrt/documents/hardening-probes.test.ts';

const args = process.argv.slice(2);
const only = args.includes('--row') ? args[args.indexOf('--row') + 1] : undefined;
const picked = MUTATIONS.filter((m) => !only || m.row === only);
if (args.includes('--list')) {
  for (const m of picked) console.log(`${m.row}  ${m.name}  (${m.file})`);
  process.exit(0);
}

let current;
const restore = () => {
  if (current) writeFileSync(current.path, current.original);
  current = undefined;
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restore();
    process.exit(130);
  });
}

const survivors = [];
for (const m of picked) {
  const path = join(repo, ORGRT, m.file);
  const original = readFileSync(path, 'utf8');
  const hits = original.split(m.find).length - 1;
  if (hits !== 1) {
    console.error(
      `${m.row} ${m.name}: expected exactly one occurrence in ${m.file}, found ${hits}`,
    );
    process.exit(2);
  }
  current = { path, original };
  writeFileSync(
    path,
    original.replace(m.find, () => m.replace),
  );
  const started = Date.now();
  const r = spawnSync('npx', ['vitest', 'run', PROBES], {
    cwd: cli,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: process.env.TMPDIR ?? '/var/tmp' },
    timeout: 300_000,
  });
  restore();
  const killed = r.status !== 0;
  console.log(
    `${killed ? 'killed  ' : 'SURVIVED'}  ${m.row}  ${m.name}  (${((Date.now() - started) / 1000).toFixed(0)}s)`,
  );
  if (!killed) survivors.push(m);
}

if (survivors.length) {
  console.error(
    `\n${survivors.length} mutant(s) survived the probe suite: a guard can be weakened unnoticed.`,
  );
  process.exit(1);
}
console.log(`\nAll ${picked.length} mutants were killed by the probe suite.`);
