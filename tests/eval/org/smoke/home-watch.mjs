// tests/eval/org/smoke/home-watch.mjs
//
// The real $HOME's top level, listed before and after a trial. A trial voids when an entry appears,
// disappears or changes there that is not on HOME_IGNORE. Added after the first paid parallel-sweep
// trials, where a role created ~/f7.sh in the real home and the older check (names in ~/.monomind, files
// naming the trial) reported clean. It complements the runtime's write-deny on the home
// (policy.sandbox.homeWriteAllow): that stops a role's writes, this proves none got through, for every
// scenario, whether or not its kit turns the write-deny on.
//
// What is compared, per top-level entry of ~: its name and type; for a file or a link also size, mtime and
// link target; for a directory nothing else (live processes change directory mtimes constantly, and what a
// directory holds is out of scope: the runners' own `.claude`, `.codex`, `.gemini` are written on purpose,
// and the already-fingerprinted ~/.monomind watch directories are env.mjs's job). An entry whose birth time
// is after the before-listing is new even under a name that existed before (a file replaced by
// rename).
//
// Not detectable from two listings: a file created and removed again inside the window, or a change made
// inside a directory. The home directory's own mtime moves for those, and also for every ignored name below
// that a live process rewrites by rename, so it is reported as a NOTE, never a void.
import { lstatSync, readdirSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Top-level names of ~ that are not a trial's doing. A trailing `*` is a prefix. Only entries that another
 *  live process on this machine, or a runner / the runtime itself, is known to touch belong here. */
export const HOME_IGNORE = [
  // the runners' own state: claude (config file + its atomic-write temp files), codex, agy
  '.claude',
  '.claude.json',
  '.claude.json.tmp.*',
  '.codex',
  '.gemini',
  // the runtime's sandbox mount-point stubs, created before a role starts and reclaimed after
  // (packages/@monomind/cli/src/orgrt/sandbox-stubs-paths.ts GLOBAL_CONFIG_STUBS and ~/.mcp.json)
  '.claude-custom-oauth.json',
  '.claude-local-oauth.json',
  '.claude-staging-oauth.json',
  '.mcp.json',
  // XDG and tool directories every tool run touches
  '.cache',
  '.local',
  '.config',
  '.npm',
  '.monomind',
  '.monomind-projects.json',
  // shells, pagers, editors and the desktop session, live on this machine while a trial runs
  '.bash_history',
  '.zsh_history',
  '.lesshst',
  '.viminfo',
  '.node_repl_history',
  '.Xauthority',
];

export const isIgnored = (name, ignore = HOME_IGNORE) =>
  ignore.some((p) => (p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : name === p));

const typeOf = (st) =>
  st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : st.isFile() ? 'file' : 'other';

/** The top level of `home`: name -> { type, size, mtimeMs, birthMs, target } (size, mtime and target
 *  only where they are compared). Never follows a link, never reads a file. */
export function homeSnapshot(home = homedir(), now = Date.now()) {
  const entries = {};
  for (const name of readdirSync(home)) {
    let st;
    try {
      st = lstatSync(join(home, name));
    } catch {
      continue; // gone between readdir and lstat: another process
    }
    const type = typeOf(st);
    entries[name] = {
      type,
      birthMs: st.birthtimeMs,
      ...(type === 'dir'
        ? {}
        : {
            size: st.size,
            mtimeMs: st.mtimeMs,
            ...(type === 'link' ? { target: readlinkSync(join(home, name)) } : {}),
          }),
    };
  }
  return { home, takenAtMs: now, dirMtimeMs: lstatSync(home).mtimeMs, entries };
}

/** What differs between two snapshots, outside `ignore`: [{ name, kind, type, size?, mtimeMs?, birthMs }].
 *  kind: created | replaced (same name, born after `before`) | changed | removed. */
export function homeOffenders(before, after, ignore = HOME_IGNORE) {
  const out = [];
  for (const [name, now] of Object.entries(after.entries)) {
    if (isIgnored(name, ignore)) continue;
    const was = before.entries[name];
    const mark = (kind) => out.push({ name, kind, ...now });
    if (!was) mark('created');
    else if (was.type !== now.type) mark('changed');
    else if (now.birthMs > before.takenAtMs) mark('replaced');
    else if (
      now.type !== 'dir' &&
      (was.size !== now.size || was.mtimeMs !== now.mtimeMs || was.target !== now.target)
    )
      mark('changed');
  }
  for (const [name, was] of Object.entries(before.entries))
    if (!isIgnored(name, ignore) && !after.entries[name])
      out.push({ name, kind: 'removed', ...was });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const iso = (ms) => (ms > 0 ? new Date(ms).toISOString() : 'unknown');

/** One line per offender, naming it with its birth and modification time so the lead can judge. */
export function describeOffender(o, home) {
  const kind = o.kind.padEnd(8);
  const path = join(home, o.name);
  if (o.kind === 'removed') return `${kind} ${path} (${o.type})`;
  const size = o.size === undefined ? '' : ` size=${o.size}`;
  const mtime = o.mtimeMs === undefined ? '' : ` mtime=${iso(o.mtimeMs)}`;
  return `${kind} ${path} (${o.type})${size} birth=${iso(o.birthMs)}${mtime}`;
}

/** Offender lines (empty = clean) and the notes that never void. */
export function homeReport(before, after, ignore = HOME_IGNORE) {
  const lines = homeOffenders(before, after, ignore).map((o) => describeOffender(o, after.home));
  const notes = [];
  if (!lines.length && after.dirMtimeMs !== before.dirMtimeMs)
    notes.push(
      `note: ${after.home} itself was modified during the trial (${iso(before.dirMtimeMs)} -> ${iso(after.dirMtimeMs)}) but no entry outside the ignore list changed: a rename by a live process (history files, .claude.json), or a file created and removed again, which two listings cannot tell apart`,
    );
  return { lines, notes };
}
