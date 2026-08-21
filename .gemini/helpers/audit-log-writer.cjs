/**
 * Security audit log writer — shared by gates-handler.cjs (plain CJS hook
 * code, no package import) and any other hook-tree script that needs to
 * persist a security decision.
 *
 * Writes JSONL to <monomind-data-root>/security/audit-events.jsonl. The data
 * root resolution mirrors getMonomindDataRoot() in
 * packages/@monomind/cli/src/utils/paths.ts (and _getGitMonomindDir() in
 * server.mjs) so this lands in the same branch-agnostic, worktree-shared
 * location as every other monomind data file — deliberately duplicated here
 * rather than imported, since this file must stay dependency-free and fast
 * on every PreToolUse invocation.
 *
 * Separate from event-logger.cjs's high-volume general event log (5-9MB/day
 * of debug telemetry) so `security audit --action clear` can truncate this
 * log without collaterally wiping unrelated data.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_AUDIT_LOG_BYTES = 25 * 1024 * 1024;

function getMonoDir(workDir) {
  try {
    const gitEntry = path.join(workDir, '.git');
    const st = fs.statSync(gitEntry);
    if (st.isDirectory()) return path.join(gitEntry, 'monomind');
    if (st.isFile()) {
      const m = fs.readFileSync(gitEntry, 'utf8').match(/^gitdir:\s*(.+)/m);
      if (m) {
        const worktreeDir = path.resolve(workDir, m[1].trim());
        return path.join(path.dirname(path.dirname(worktreeDir)), 'monomind');
      }
    }
  } catch { /* fall through to default below */ }
  return path.join(workDir, '.monomind');
}

/** Resolve the audit log's directory + file path for a given cwd. */
function resolveAuditLogPaths(cwd) {
  const workDir = cwd || process.env.MONOMIND_CWD || process.cwd();
  const monoDir = process.env.MONOMIND_DATA_DIR || getMonoDir(workDir);
  const dir = path.join(monoDir, 'security');
  return { dir, file: path.join(dir, 'audit-events.jsonl') };
}

/**
 * Append one audit event. Never throws — a logging failure must not break
 * the gate it's recording. Rotates (archive + truncate) when the log grows
 * past MAX_AUDIT_LOG_BYTES rather than growing unbounded.
 *
 * event: { source, decision, tool?, reason?, path? }
 */
function appendAuditEvent(event, cwd) {
  try {
    const { dir, file } = resolveAuditLogPaths(cwd);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_AUDIT_LOG_BYTES) {
        fs.renameSync(file, `${file}.${Date.now()}.bak`);
      }
    } catch { /* file doesn't exist yet — nothing to rotate */ }
    const entry = Object.assign({ timestamp: new Date().toISOString() }, event);
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch { /* never let audit logging break the caller */ }
}

module.exports = { appendAuditEvent, resolveAuditLogPaths, getMonoDir };
