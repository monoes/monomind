// packages/@monomind/cli/src/orgrt/write-ledger.ts
/**
 * Write verification. A role whose Write/Edit was refused (policy denial, a
 * sandbox refusal, any tool_result with ok:false) and that then reported the
 * deliverable "written" without looking cost a whole run in parallel-sweep-2.
 * The runtime already sees every file-tool call (`tool` events carrying the
 * path and the harness call id) and its outcome (`tool_result` events with
 * `ok`), so it can tell, without a model, which writes failed and were never
 * redone.
 *
 * Conservative by construction: a path is only ever flagged when a Write/Edit
 * to it DEMONSTRABLY failed, no later write to it succeeded, and the file is
 * still missing or empty on disk. A runtime that reports no tool_result, a
 * path never seen failing, or a file that exists with content is never
 * flagged. Each (scope, path) is refused at most MAX_REFUSALS times, so the
 * gate can warn a role but never trap a run.
 */
import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { BusEvent } from './types.js';

/** How many times one (scope, path) failure may refuse a completion. */
export const MAX_REFUSALS = 2;

const WRITE_TOOL = /^(write|edit|multiedit|notebookedit)$/i;
const REFUSAL_WORDS = /denied|refus|sandbox|not permitted|permission|read-only|EROFS|EACCES/i;
/** A report that names the path and says it is blocked is honest, not refused. */
const BLOCKED_WORDS = /block|refus|denied|fail|could not|couldn't|unable|cannot|can't|not written/i;

function inputPaths(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const i = input as Record<string, unknown>;
  const edits = Array.isArray(i.edits) ? (i.edits as Array<{ file_path?: unknown }>) : [];
  return [i.file_path, i.notebook_path, ...edits.map((e) => e?.file_path)].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
}

export interface FailedWrite {
  role: string;
  path: string;
  reason: string;
  /** "refused" for a policy/sandbox denial, else "failed". */
  kind: 'refused' | 'failed';
}

export class WriteLedger {
  private pending = new Map<string, { role: string; paths: string[] }>();
  private failed = new Map<string, FailedWrite>(); // `${role}\0${abs path}`
  private refusals = new Map<string, number>();

  /** @param bases directories a relative path may have been written against. */
  constructor(private bases: () => string[]) {}

  private abs(p: string): string {
    return resolve(this.bases()[0] ?? '/', p);
  }

  observe(e: BusEvent): void {
    if (!e.from || !e.tool || !WRITE_TOOL.test(e.tool)) return;
    const data = (e.data ?? {}) as Record<string, unknown>;
    if (e.type === 'tool') {
      const paths = inputPaths(data.input);
      if (e.decision === 'deny') {
        for (const p of paths) this.fail(e.from, p, e.reason ?? 'denied', 'refused');
      } else if (e.decision === 'allow' && typeof data.call_id === 'string') {
        this.pending.set(data.call_id, { role: e.from, paths });
      }
    } else if (e.type === 'tool_result' && typeof data.call_id === 'string') {
      const call = this.pending.get(data.call_id);
      if (!call) return;
      this.pending.delete(data.call_id);
      for (const p of call.paths) {
        if (data.ok === false) {
          const out = String(data.output ?? '').trim();
          this.fail(call.role, p, out, REFUSAL_WORDS.test(out) ? 'refused' : 'failed');
        } else this.failed.delete(`${call.role}\0${this.abs(p)}`);
      }
    }
  }

  private fail(role: string, path: string, reason: string, kind: FailedWrite['kind']): void {
    this.failed.set(`${role}\0${this.abs(path)}`, {
      role,
      path,
      reason: reason.replace(/\s+/g, ' ').slice(0, 160),
      kind,
    });
  }

  /** Failed writes with no later success whose file is still missing/empty. */
  unresolved(role?: string): FailedWrite[] {
    return [...this.failed.values()].filter(
      (f) => (role === undefined || f.role === role) && !this.landed(f.path),
    );
  }

  private landed(path: string): boolean {
    const candidates = new Set([this.abs(path), ...this.bases().map((b) => resolve(b, path))]);
    for (const p of candidates) {
      try {
        if (statSync(p).size > 0) return true;
      } catch {
        /* missing */
      }
    }
    return false;
  }

  /** Writes to refuse a completion over: unresolved, not acknowledged in
   *  `report`, and still under the refusal cap. Counts the refusal. */
  private due(role: string | undefined, report: string): FailedWrite[] {
    const out: FailedWrite[] = [];
    for (const f of this.unresolved(role)) {
      const named = report.includes(f.path) || report.includes(basename(f.path));
      if (named && BLOCKED_WORDS.test(report)) continue;
      const key = `${role ?? '*'}\0${this.abs(f.path)}`;
      const n = this.refusals.get(key) ?? 0;
      if (n >= MAX_REFUSALS) continue;
      this.refusals.set(key, n + 1);
      out.push(f);
    }
    return out;
  }

  /** org_task_done by `role`: a refusal message, or null to allow. */
  checkTaskDone(role: string, result: string | undefined): string | null {
    const due = this.due(role, result ?? '');
    if (due.length === 0) return null;
    const f = due[0];
    const all = due.length > 1 ? ` (all: ${due.map((d) => d.path).join(', ')})` : '';
    return (
      `org_task_done refused: your write to ${f.path} was ${f.kind} (${f.reason || 'no detail'}) and no later write to it succeeded${all}; the file is not on disk with content. ` +
      `Verify with ls -l / Read and retry the write, or, if it cannot be written, say so in \`result\` naming the path and report it as blocked to the lead instead of "written".`
    );
  }

  /** An `achieved` org_complete: a refusal message, or null to allow. */
  checkRunAchieved(summary: string): string | null {
    const due = this.due(undefined, summary);
    if (due.length === 0) return null;
    const list = due.map((f) => `"${f.role}" -> ${f.path}`).join('; ');
    return (
      `org_complete refused: outcome 'achieved' but a write failed and was never redone, and the file is not on disk with content: ${list}. ` +
      `Verify with ls -l, have the role retry or reassign the work to another role, or end with outcome 'partial' (blocker 'external', blockerDetail naming the unwritten deliverable) instead of 'achieved'.`
    );
  }
}
