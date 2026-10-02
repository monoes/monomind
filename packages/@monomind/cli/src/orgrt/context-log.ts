// packages/@monomind/cli/src/orgrt/context-log.ts
/**
 * Per-call context logging (org sections spec, section 9, Phase 1).
 *
 * Every model call a role makes appends one record to the run's
 * `context.jsonl`: how large its context was, how old its session is, and how
 * much of the prompt was read from cache or written to it. The first call of a
 * session is flagged, because its cache read vs write is the prefix cost of
 * starting that session (a cold start writes the whole prefix at 1.25x, a warm
 * one reads it at 0.1x). `summarizeContextLog` turns the records into the
 * per-role figures the eval compares between configurations.
 *
 * One file per run, kept apart from `bus.jsonl` so the event stream and every
 * reader of it stay as they were. The writer is synchronous and best effort: a
 * run directory that is being torn down must never fail a model call.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ContextCallRecord {
  ts: number;
  role: string;
  /** The session key: a task id under task scope, `_role` for a role-wide session. */
  task_key: string;
  /** The SDK session id, when the runner has reported one yet. */
  session_id?: string;
  /** This session resumed an earlier SDK session. */
  resumed: boolean;
  /** 0 for the first model call of the session. */
  call_index: number;
  /** Milliseconds since the session started. */
  session_age_ms: number;
  /** The first call of its session: its cache split is the session's prefix cost. */
  first_call: boolean;
  /** A subagent's call rather than the role's own. */
  parent: boolean;
  response_id?: string;
  /** Everything the model read: uncached input plus cache reads plus cache writes. */
  context_tokens: number;
  input: number;
  cache_read: number;
  cache_creation: number;
  /** Output tokens as first reported; early messages of a response can carry a placeholder. */
  output: number;
  /** cache_read / context_tokens. */
  cache_hit_ratio: number;
}

const FILE = 'context.jsonl';
const dirsReady = new Set<string>();

export const contextLogPath = (runDir: string): string => join(runDir, FILE);

/** Append one record. Never throws. */
export function appendContextCall(runDir: string, rec: ContextCallRecord): void {
  try {
    if (!dirsReady.has(runDir)) {
      mkdirSync(runDir, { recursive: true });
      dirsReady.add(runDir);
    }
    appendFileSync(contextLogPath(runDir), `${JSON.stringify(rec)}\n`);
  } catch {
    /* the run directory is going away, or the disk is full; the call itself must not fail */
  }
}

/** The records of a run, oldest first; a missing or partly written file reads as what it holds. */
export function readContextLog(runDir: string): ContextCallRecord[] {
  const file = contextLogPath(runDir);
  if (!existsSync(file)) return [];
  const out: ContextCallRecord[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ContextCallRecord);
    } catch {
      /* a torn final line */
    }
  }
  return out;
}

export interface RoleContextSummary {
  role: string;
  calls: number;
  /** Session starts: the number of first calls. */
  sessions: number;
  max_context_tokens: number;
  mean_context_tokens: number;
  /** cache_read / context over all calls. */
  cache_hit_ratio: number;
  /** Prefix cache tokens read and written on session-start calls. */
  start_cache_read_tokens: number;
  start_cache_write_tokens: number;
  /** write / (write + read) over session starts; null with no starts or no cache tokens. */
  start_write_share: number | null;
}

/** Per-role figures, in order of first appearance. */
export function summarizeContextLog(records: ContextCallRecord[]): RoleContextSummary[] {
  const byRole = new Map<string, ContextCallRecord[]>();
  for (const r of records) byRole.set(r.role, [...(byRole.get(r.role) ?? []), r]);
  return [...byRole].map(([role, rs]) => {
    const total = rs.reduce((n, r) => n + r.context_tokens, 0);
    const read = rs.reduce((n, r) => n + r.cache_read, 0);
    const starts = rs.filter((r) => r.first_call);
    const startRead = starts.reduce((n, r) => n + r.cache_read, 0);
    const startWrite = starts.reduce((n, r) => n + r.cache_creation, 0);
    return {
      role,
      calls: rs.length,
      sessions: starts.length,
      max_context_tokens: Math.max(...rs.map((r) => r.context_tokens)),
      mean_context_tokens: total / rs.length,
      cache_hit_ratio: total ? read / total : 0,
      start_cache_read_tokens: startRead,
      start_cache_write_tokens: startWrite,
      start_write_share:
        starts.length && startRead + startWrite ? startWrite / (startRead + startWrite) : null,
    };
  });
}
