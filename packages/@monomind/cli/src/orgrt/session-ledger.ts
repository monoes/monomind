/**
 * ADR-O001 D3 — task-keyed model-session records.
 *
 * The OS process running a role is ephemeral; the provider/model session is
 * the thing worth keeping, because on the measured run 98.7% of billed tokens
 * were cache reads of it. This ledger is what lets a role's process exit and
 * a later process resume the RIGHT model session — one per (role, runtime,
 * task), the shape of Paperclip's agent_task_sessions
 * (companyId, agentId, adapterType, taskKey) — and it records, per session
 * run, the session id before and after so a resume is auditable instead of
 * assumed. Without that record a runner that silently ignored `resume` looked
 * exactly like one that honoured it.
 *
 * Lives at `.monomind/orgs/<org>/<run>/sessions.json`: under the gitignored
 * state dir, and scoped to the run because task ids (`task-N`) repeat across
 * runs while `org run --resume` keeps the run id.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OrgDef, OrgRole } from './types.js';

/** Key for everything a role receives outside a task (and for role scope). */
export const ROLE_SESSION_KEY = '_role';
/** Warm state is bounded (Paperclip caps every warm store); so is this history. */
export const MAX_SESSION_RUNS = 500;

/** 'cold' (ADR-O001 D6): a new model session per message, never resumed. */
export type SessionScope = 'role' | 'task' | 'cold';

export type SessionStartReason =
  | 'resumed'
  | 'fresh-no-record'
  | 'fresh-cwd-changed'
  | 'fresh-prompt-changed'
  | 'fresh-after-stale-resume'
  | 'fresh-after-turn-limit'
  | 'fresh-cold';

interface RecordKey {
  role: string;
  runtime: string;
  taskKey: string;
}

export interface SessionRecord extends RecordKey {
  sessionId: string;
  cwd: string;
  /** Hash of the system prompt the session was built with; '*' matches any. */
  promptHash: string;
  updatedAt?: number;
}

export interface SessionRun extends RecordKey {
  sessionIdBefore?: string;
  sessionIdAfter?: string;
  /** True only when the session id survived the run — the audit's point. */
  resumed: boolean;
  reason: SessionStartReason;
  startedAt: number;
  endedAt: number;
  error?: string;
}

/** The leading `[task:<id>]` tag decisions.ts puts on every task dispatch. */
export function taskKeyOf(text: string): string | undefined {
  return /^\[task:([^\]\s]+)\]/.exec(text)?.[1];
}

/** The task session a message belongs to, or undefined for "whichever is
 *  current". A dispatch leads with `[task:<id>]`; mail arrives as
 *  `[message from <sender>] subject: <subject>` and is routed by a
 *  `[task:<id>]` in its subject line (task-scoped senders add one), else by
 *  the task whose session last wrote to that sender. The body is never read:
 *  a quoted tag there says nothing about where the message belongs. */
export function mailRouteKey(
  text: string,
  correspondents: ReadonlyMap<string, string>,
): string | undefined {
  const tagged = taskKeyOf(text);
  if (tagged) return tagged;
  const head = /^\[message from ([^\]]+)\] subject: ([^\n]*)/.exec(text);
  if (!head) return undefined;
  return /\[task:([^\]\s]+)\]/.exec(head[2])?.[1] ?? correspondents.get(head[1]);
}

/** 'role' (one session for the role's life — the pre-D3 behaviour) unless the
 *  org or the role opts into 'task'. The coordinator's work spans tasks, so an
 *  org-wide 'task' does not apply to it; it can still opt in itself. */
export function resolveSessionScope(
  role: Pick<OrgRole, 'reports_to'> & { session_scope?: SessionScope; review_input?: string },
  def: Pick<OrgDef, 'run_config'> | undefined,
): SessionScope {
  // D6: an artifact-only reviewer is cold whatever else is configured — a
  // reviewer that remembers earlier rounds is exactly what D6 removes.
  if (role.review_input === 'artifact-only') return 'cold';
  if (role.session_scope) return role.session_scope;
  if (role.reports_to == null) return 'role';
  const rc = def?.run_config as { session_scope?: SessionScope } | undefined;
  return rc?.session_scope ?? 'role';
}

const keyOf = (k: RecordKey): string => JSON.stringify([k.role, k.runtime, k.taskKey]);

export class SessionLedger {
  private records = new Map<string, SessionRecord>();
  private history: SessionRun[] = [];

  /** `file` omitted = in-memory only (tests, or a daemon with no run dir). */
  constructor(private readonly file?: string) {
    if (!file || !existsSync(file)) return;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        records?: SessionRecord[];
        runs?: SessionRun[];
      };
      for (const r of raw.records ?? []) this.records.set(keyOf(r), r);
      this.history = (raw.runs ?? []).slice(-MAX_SESSION_RUNS);
    } catch {
      // A corrupt ledger must not stop an org: every lookup degrades to a
      // fresh session, which is recorded with its reason.
    }
  }

  /** Which session to resume for this key, or why none can be. */
  resumeFor(q: RecordKey & { cwd: string; promptHash: string }): {
    sessionId?: string;
    reason: SessionStartReason;
  } {
    const r = this.records.get(keyOf(q));
    if (!r) return { reason: 'fresh-no-record' };
    // SDK sessions are stored per working directory; resuming from another
    // cwd either fails or silently finds nothing.
    if (r.cwd !== q.cwd) return { reason: 'fresh-cwd-changed' };
    // D7: never change a live session's system prompt — a different prompt is
    // a different session.
    if (r.promptHash !== '*' && r.promptHash !== q.promptHash)
      return { reason: 'fresh-prompt-changed' };
    return { sessionId: r.sessionId, reason: 'resumed' };
  }

  set(r: SessionRecord): void {
    this.records.set(keyOf(r), { ...r, updatedAt: Date.now() });
    this.save();
  }

  drop(k: RecordKey): void {
    if (this.records.delete(keyOf(k))) this.save();
  }

  recordRun(run: Omit<SessionRun, 'resumed'>): SessionRun {
    const entry: SessionRun = {
      ...run,
      resumed: run.sessionIdBefore !== undefined && run.sessionIdBefore === run.sessionIdAfter,
    };
    this.history.push(entry);
    if (this.history.length > MAX_SESSION_RUNS)
      this.history.splice(0, this.history.length - MAX_SESSION_RUNS);
    this.save();
    return entry;
  }

  runs(): SessionRun[] {
    return [...this.history];
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(
        this.file,
        JSON.stringify({ records: [...this.records.values()], runs: this.history }, null, 2),
      );
    } catch {
      // Best-effort audit trail: a full disk must not crash a role mid-task.
    }
  }
}
