import fs from 'node:fs';
import path from 'node:path';
import { _writeQueue } from './server-rundb.mjs';

// ── Bounded file reads for session JSONL (P3-6b) ────────────────────────────
// /api/session already caps memory correctly by tailing; /api/session-journal and
// /api/session-errors used to fs.readFileSync() whole session files regardless of
// size, so one request against a multi-hundred-MB session log (a real scenario for
// long-running org sessions) buffers the entire file. These helpers cap the read to
// a fixed byte window via openSync/readSync (mirrors the byte-offset tail-read the
// /api/loops handler already uses for ScheduleWakeup lookups) instead of loading the
// whole file.
function _readTailLines(filePath, maxBytes) {
  maxBytes = maxBytes || 4 * 1024 * 1024; // 4MB — generous for the most recent activity
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const len = stat.size - start;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, len, start);
  } finally {
    fs.closeSync(fd);
  }
  let text = buf.toString('utf8');
  if (start > 0) {
    // We started mid-file — the first line is very likely a partial line, drop it.
    const nl = text.indexOf('\n');
    text = nl === -1 ? '' : text.slice(nl + 1);
  }
  return text.split('\n').filter(Boolean);
}

function _readHeadText(filePath, maxBytes) {
  maxBytes = maxBytes || 8192; // enough for the JSONL header line(s) we need to inspect
  const stat = fs.statSync(filePath);
  const len = Math.min(maxBytes, stat.size);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, len, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buf.toString('utf8');
}
// ─────────────────────────────────────────────────────────────────────────────

// Paths whose append already failed once — warn once per path, not on every event.
const _appendWarned = new Set();
function appendToFile(filePath, line) {
  const prev = _writeQueue.get(filePath) || Promise.resolve();
  const next = prev.then(() => {
    try {
      fs.appendFileSync(filePath, line);
    } catch (err) {
      if (!_appendWarned.has(filePath)) {
        if (_appendWarned.size >= 1000) _appendWarned.clear();
        _appendWarned.add(filePath);
        console.warn(`[server] append to ${filePath} failed: ${err?.message || err}`);
      }
    }
  });
  _writeQueue.set(filePath, next);
  next.then(() => {
    if (_writeQueue.get(filePath) === next) _writeQueue.delete(filePath);
  });
  return next;
}

// Returns the shared git directory parent so run files survive branch switches and
// are shared across all worktrees. In a worktree, .git is a FILE pointing to the
// shared .git dir (e.g. /main/.git/worktrees/feat); we navigate up two levels to
// reach /main/.git, then up one more to /main/ for the monomind data root.
// Falls back to the working directory if git isn't available.
const _gitMonomindCache = new Map();
const _MAX_GIT_CACHE = 100;
function _getGitMonomindDir(workDir) {
  if (!workDir) return null;
  if (_gitMonomindCache.has(workDir)) return _gitMonomindCache.get(workDir);
  let result = null;
  let resolved = false; // only a real git lookup is cached, never the fallback
  try {
    const gitEntry = path.join(workDir, '.git');
    const st = fs.statSync(gitEntry);
    if (st.isDirectory()) {
      // Regular repo: .git is a directory
      result = path.join(gitEntry, 'monomind');
      resolved = true;
    } else if (st.isFile()) {
      // Worktree: .git is a text file "gitdir: /main/.git/worktrees/name"
      const m = fs
        .readFileSync(gitEntry, 'utf8')
        .trim()
        .match(/^gitdir:\s*(.+)/);
      if (m) {
        // Resolve relative paths (gitdir can be relative to the worktree root)
        const worktreeDir = path.resolve(workDir, m[1].trim());
        // /main/.git/worktrees/name -> /main/.git -> /main/.git/monomind
        const commonGitDir = path.dirname(path.dirname(worktreeDir));
        result = path.join(commonGitDir, 'monomind');
        resolved = true;
      }
    }
  } catch {}
  if (!result) result = path.join(workDir, '.monomind'); // fallback
  if (!resolved) return result; // .git may appear later — don't pin the fallback
  if (_gitMonomindCache.size >= _MAX_GIT_CACHE) {
    const oldest = _gitMonomindCache.keys().next().value;
    _gitMonomindCache.delete(oldest);
  }
  _gitMonomindCache.set(workDir, result);
  return result;
}

/**
 * Validates a caller-supplied ?dir= for routes that spawn processes or write files.
 * Returns the resolved dir when it is absent (server project), the server project dir,
 * or a project listed in data/known-projects.json; otherwise null.
 */
function resolveAllowedProjectDir(rawDir, serverProjectDir) {
  const serverDir = path.resolve(serverProjectDir || process.cwd());
  if (rawDir === undefined || rawDir === null || rawDir === '') return serverDir;
  if (typeof rawDir !== 'string' || rawDir.length > 4096 || rawDir.includes('\0')) return null;
  const d = path.resolve(rawDir);
  if (d === serverDir) return d;
  try {
    const known = JSON.parse(
      fs.readFileSync(path.join(serverDir, 'data', 'known-projects.json'), 'utf8'),
    );
    if (Array.isArray(known) && known.some((k) => typeof k === 'string' && path.resolve(k) === d)) {
      return d;
    }
  } catch (_) {}
  return null;
}

/** True when target resolves to root itself or somewhere beneath it. */
function isPathInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function getMonomindHome(projectDir, projectDirExplicit) {
  if (projectDirExplicit && projectDir) return path.resolve(projectDir);
  if (process.env.MONOMIND_HOME) return path.resolve(process.env.MONOMIND_HOME);
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.monomind', 'control.json'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) break;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export {
  _getGitMonomindDir,
  _readHeadText,
  _readTailLines,
  appendToFile,
  isPathInside,
  resolveAllowedProjectDir,
};
