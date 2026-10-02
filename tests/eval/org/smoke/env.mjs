// tests/eval/org/smoke/env.mjs
//
// A trial's own runtime state, with the runners' logins left alone. The HOME of
// the process stays the real one, because the claude, codex and other CLIs
// authenticate from it, but everything the org runtime itself writes is pointed
// at the trial root: MONOMIND_HOME (with the read-only installs it needs linked
// in), the broker directory and the operator-credential directory. After a trial
// the real ~/.monomind is checked for any leak.
//
//   env.mjs prepare <trial root>          prints KEY=VALUE lines to export
//   env.mjs fingerprint                   prints the real state's directory listing
//   env.mjs leaks <trial name> [epoch s]  prints paths in the real state naming the trial and written since; exit 1 if any
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read-only pieces of the real MONOMIND_HOME the runtime needs: the optional SDK installs
 *  and the skill library. Linked, never copied, and never written by a trial. */
const LINKED = ['deps', 'org-skills', 'models'];
/** The directories whose contents the trial must not change. */
const WATCHED = ['orgs', 'orgrt-broker', 'orgrt-operator'];
/** Never scanned for leaks: large, and not state a trial writes. */
const SKIP = new Set([
  'global-brain',
  'knowledge',
  'models',
  'deps',
  'cache',
  'org-skills',
  'neural',
]);

export function prepareTrialHome(root, realHome = homedir()) {
  const state = join(resolve(root), '.state');
  const home = join(state, 'monomind-home');
  for (const d of [home, join(state, 'broker'), join(state, 'operator'), join(state, 'projects')])
    mkdirSync(d, { recursive: true, mode: 0o700 });
  for (const name of LINKED) {
    const real = join(realHome, '.monomind', name);
    if (existsSync(real) && !existsSync(join(home, name))) symlinkSync(real, join(home, name));
  }
  return {
    MONOMIND_HOME: home,
    MONOMIND_ORGRT_BROKER_DIR: join(state, 'broker'),
    MONOMIND_ORGRT_OPERATOR_DIR: join(state, 'operator'),
    // the project memory store (memory-bridge-paths.ts projectDataDir) otherwise lands in the real ~/.monomind/projects
    MONOMIND_PROJECTS_DIR: join(state, 'projects'),
  };
}

/** Names (not times or sizes: live daemons rewrite those) in the watched real directories. */
export function realStateFingerprint(realHome = homedir()) {
  const out = {};
  for (const d of WATCHED) {
    const p = join(realHome, '.monomind', d);
    out[d] = existsSync(p) ? readdirSync(p).sort() : [];
  }
  return out;
}

/** The newest modification time under a path (itself included). */
function newestMtime(p) {
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(st.mtimeMs, ...readdirSync(p).map((e) => newestMtime(join(p, e))));
}

/** Paths under the real state that name the trial, by file name or content, and that were written
 *  at or after `sinceMs`: a trial that reached it. Anything older, such as the store of an earlier
 *  dry run that had the same name, is not this trial's. */
export function leaks(trialName, realHome = homedir(), sinceMs = 0) {
  const base = join(realHome, '.monomind');
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (dir === base && SKIP.has(e.name)) continue;
      if (e.name.includes(trialName)) {
        if (newestMtime(p) >= sinceMs) hits.push(p);
      } else if (e.isDirectory()) walk(p, depth + 1);
      else if (
        e.isFile() &&
        statSync(p).size < 2_000_000 &&
        statSync(p).mtimeMs >= sinceMs &&
        readFileSync(p, 'utf8').includes(trialName)
      )
        hits.push(p);
    }
  };
  walk(base, 0);
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg, since] = process.argv.slice(2);
  if (cmd === 'prepare')
    for (const [k, v] of Object.entries(prepareTrialHome(arg))) console.log(`${k}=${v}`);
  else if (cmd === 'fingerprint') console.log(JSON.stringify(realStateFingerprint()));
  else if (cmd === 'leaks') {
    const hits = leaks(arg, homedir(), since ? Number(since) * 1000 : 0);
    for (const h of hits) console.log(h);
    process.exit(hits.length ? 1 : 0);
  } else {
    console.error('usage: env.mjs prepare <root> | fingerprint | leaks <trial name>');
    process.exit(2);
  }
}
