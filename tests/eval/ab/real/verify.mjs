#!/usr/bin/env node
// Free, offline proof that every real task's hidden check discriminates:
//   1. on the untouched slice + overlay the check must FAIL (non-zero);
//   2. with the reference solution (real/reference/<task-id>.patch, `patch -p1`) applied it must PASS.
// Spawns no agent and spends nothing. Needs the slices fetched (fetch.mjs).
//
//   node tests/eval/ab/real/verify.mjs [--tasks DIR] [--only id,id]   (default: tasks-real + tasks-hard)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceDir, sliceId } from './slices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AB = resolve(HERE, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
// Default: every pinned-slice task set (tasks-real and tasks-hard); --tasks narrows it to one dir.
const tasksDirs = argv.includes('--tasks')
  ? [resolve(opt('--tasks'))]
  : [join(AB, 'tasks-real'), join(AB, 'tasks-hard')].filter((d) => existsSync(d));
const only = opt('--only')?.split(',');

const tasks = tasksDirs
  .flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))),
  )
  .filter((t) => !only || only.includes(t.id));

function runCheck(task, patchFile) {
  const ws = mkdtempSync(join(tmpdir(), `mm-ab-verify-${task.id}-`));
  try {
    cpSync(sliceDir(sliceId(task.fixture)), ws, { recursive: true });
    if (patchFile) {
      const p = spawnSync('patch', ['-p1', '-s', '-i', patchFile], { cwd: ws, encoding: 'utf8' });
      if (p.status !== 0) return { status: 'patch-failed', out: p.stdout + p.stderr };
    }
    cpSync(join(AB, task.check.overlay), ws, { recursive: true });
    const [cmd, ...args] = task.check.command;
    const c = spawnSync(cmd, args, {
      cwd: ws,
      encoding: 'utf8',
      timeout: (task.check.timeoutS ?? 60) * 1000,
    });
    return { status: c.status, out: (c.stdout ?? '') + (c.stderr ?? '') };
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

let bad = 0;
for (const t of tasks) {
  const patch = join(HERE, 'reference', `${t.id}.patch`);
  const before = runCheck(t, null);
  const failsBefore = before.status !== 0 && before.status !== null;
  let after = null;
  if (existsSync(patch)) after = runCheck(t, patch);
  const passesAfter = after?.status === 0;
  const ok = failsBefore && passesAfter;
  if (!ok) bad++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${t.id.padEnd(34)} before: exit ${before.status} (want !=0)  reference: ${
      after ? `exit ${after.status} (want 0)` : 'no patch'
    }`,
  );
  if (!ok && after && !passesAfter) console.log(after.out.split('\n').slice(0, 12).join('\n'));
}
console.log(`\n${tasks.length - bad}/${tasks.length} verified`);
process.exit(bad ? 1 : 0);
