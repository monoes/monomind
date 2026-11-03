/**
 * On-disk accounting for init's summary box (#420).
 *
 * `result.created.files` holds one entry per *item* (a whole skill folder, an
 * agent category, "memory: N patterns seeded"), and `result.skipped` mixes
 * already-present files with diagnostics, so their lengths said "267 created,
 * 101 already exist" for an empty repo that actually received ~2,060 files.
 * The summary instead diffs what is on disk before and after the run.
 *
 * Only the places init writes are walked — files at the project root and the
 * top-level dot-directories (.claude, .agents, .codex, .gemini, .kimi-code,
 * .opencode, .monomind, …) — so a large source tree is never scanned.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Never walked: VCS data and the code graph a detached child may still be writing. */
const EXCLUDED = new Set(['.git', path.join('.monomind', 'graph')]);

export interface InitFileSnapshot {
  files: Set<string>;
  directories: Set<string>;
  /** Wall-clock start of the run; files modified at or after it were rewritten. */
  startedAtMs: number;
}

export interface InitFileCounts {
  filesCreated: number;
  filesUpdated: number;
  filesUnchanged: number;
  directoriesCreated: number;
}

type Visit = (rel: string, stat: fs.Stats) => void;

function walk(root: string, rel: string, visit: Visit): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (EXCLUDED.has(childRel) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      // Root level: only dot-directories are init's; user source dirs are skipped.
      if (!rel && !entry.name.startsWith('.')) continue;
      visit(childRel, fs.statSync(path.join(root, childRel)));
      walk(root, childRel, visit);
    } else if (entry.isFile()) {
      visit(childRel, fs.statSync(path.join(root, childRel)));
    }
  }
}

export function snapshotInitFiles(root: string): InitFileSnapshot {
  const snapshot: InitFileSnapshot = {
    files: new Set(),
    directories: new Set(),
    // Truncated to whole seconds: some filesystems store mtimes at 1s resolution.
    startedAtMs: Math.floor(Date.now() / 1000) * 1000,
  };
  walk(root, '', (rel, stat) => {
    (stat.isDirectory() ? snapshot.directories : snapshot.files).add(rel);
  });
  return snapshot;
}

export function countInitFiles(root: string, before: InitFileSnapshot): InitFileCounts {
  const counts: InitFileCounts = {
    filesCreated: 0,
    filesUpdated: 0,
    filesUnchanged: 0,
    directoriesCreated: 0,
  };
  walk(root, '', (rel, stat) => {
    if (stat.isDirectory()) {
      if (!before.directories.has(rel)) counts.directoriesCreated++;
    } else if (!before.files.has(rel)) {
      counts.filesCreated++;
    } else if (stat.mtimeMs >= before.startedAtMs) {
      counts.filesUpdated++;
    } else if (rel.includes(path.sep)) {
      // Untouched root files (package.json, README.md, …) are the user's, not
      // init's, so only untouched files inside the dot-directories count.
      counts.filesUnchanged++;
    }
  });
  return counts;
}

/** Summary-box lines; empty categories are left out. */
export function formatInitFileCounts(counts: InitFileCounts): string[] {
  const lines: string[] = [];
  if (counts.directoriesCreated > 0) {
    lines.push(`Directories: ${counts.directoriesCreated} created`);
  }
  if (counts.filesCreated > 0) lines.push(`Files: ${counts.filesCreated} created`);
  if (counts.filesUpdated > 0) lines.push(`Updated: ${counts.filesUpdated} existing files`);
  if (counts.filesUnchanged > 0) {
    lines.push(`Unchanged: ${counts.filesUnchanged} existing files left as they were`);
  }
  return lines;
}

/** One-line wrap-up printed after a real init: how much was written and what to try. */
export function initWroteLine(counts: InitFileCounts): string {
  const n = counts.filesCreated + counts.filesUpdated;
  const files = `${n} file${n === 1 ? '' : 's'}`;
  return `Wrote ${files} (${counts.filesCreated} created, ${counts.filesUpdated} updated). Try next: monomind doctor`;
}
