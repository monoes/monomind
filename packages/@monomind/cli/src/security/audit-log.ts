/**
 * Security audit log — reader/writer for the JSONL trail written by
 * `.claude/helpers/audit-log-writer.cjs` (gates-handler.cjs's block/deny
 * decisions) and consumed by `monomind security audit`.
 *
 * Deliberately separate from `src/consensus/audit-writer.ts` (HMAC-signed,
 * built for monoswarm vote audits — no adversary model applies to a local
 * security log a user can already edit their own files in) and from the
 * high-volume general event log under `.git/monomind/events/` (so `clear`
 * can truncate this log without wiping unrelated debug telemetry).
 *
 * Path resolution mirrors getMonomindDataRoot() — same canonical,
 * branch-agnostic, worktree-shared root every other monomind data file uses.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, renameSync, statSync } from 'fs';
import { join } from 'path';
import { getMonomindDataRoot } from '../utils/paths.js';

export interface AuditEvent {
  timestamp: string;
  source: string;
  decision: string;
  tool?: string;
  reason?: string;
  path?: string;
}

const MAX_AUDIT_LOG_BYTES = 25 * 1024 * 1024;
const MAX_LINES_READ = 50000;

export function resolveAuditLogPaths(cwd?: string): { dir: string; file: string } {
  const dataRoot = getMonomindDataRoot(cwd);
  const dir = join(dataRoot, 'security');
  return { dir, file: join(dir, 'audit-events.jsonl') };
}

/** Append one audit event. Mirrors the CJS writer's rotation behavior. */
export function appendAuditEvent(event: Omit<AuditEvent, 'timestamp'>, cwd?: string): void {
  const { dir, file } = resolveAuditLogPaths(cwd);
  mkdirSync(dir, { recursive: true });
  try {
    const st = statSync(file);
    if (st.size > MAX_AUDIT_LOG_BYTES) {
      renameSync(file, `${file}.${Date.now()}.bak`);
    }
  } catch { /* file doesn't exist yet */ }
  const entry: AuditEvent = { timestamp: new Date().toISOString(), ...event };
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

/**
 * Read audit events, most recent last (file order). Bounded to
 * MAX_LINES_READ lines to avoid loading an unbounded file into memory —
 * the rotation in appendAuditEvent already caps the file at ~25MB, this is
 * a second, cheaper bound on line count.
 */
export function readAuditEvents(cwd?: string): AuditEvent[] {
  const { file } = resolveAuditLogPaths(cwd);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const bounded = lines.length > MAX_LINES_READ ? lines.slice(-MAX_LINES_READ) : lines;
  const events: AuditEvent[] = [];
  for (const line of bounded) {
    try {
      events.push(JSON.parse(line) as AuditEvent);
    } catch { /* skip malformed line */ }
  }
  return events;
}

export function filterAuditEvents(events: AuditEvent[], filter?: string): AuditEvent[] {
  if (!filter) return events;
  const needle = filter.toLowerCase();
  return events.filter(e =>
    e.source.toLowerCase().includes(needle) ||
    e.decision.toLowerCase().includes(needle) ||
    (e.tool ?? '').toLowerCase().includes(needle) ||
    (e.reason ?? '').toLowerCase().includes(needle)
  );
}

/**
 * Archive-then-truncate: renames the live log to a timestamped `.bak`
 * rather than deleting, so `clear` never silently destroys the trail it
 * exists to preserve. Returns the archived path, or null if there was
 * nothing to clear.
 */
export function clearAuditLog(cwd?: string): { archived: string | null; cleared: number } {
  const { file } = resolveAuditLogPaths(cwd);
  if (!existsSync(file)) return { archived: null, cleared: 0 };
  const cleared = readAuditEvents(cwd).length;
  const archived = `${file}.${Date.now()}.bak`;
  renameSync(file, archived);
  return { archived, cleared };
}
