// orgrt/documents/check-journal.ts
//
// The durable record of org_doc_check calls (org sections plan P3.11): `<docs dir>/checks.jsonl`, one JSON line
// per call, appended and fsynced before the call returns its result. It is a SIBLING journal of the event log,
// like the notice journal (P3.8), not a new event type: a check changes no document state, so the closed event
// union, the replay, the snapshot and the P3.5 goldens stay as they are, and a lost or damaged line only costs
// a count. Reports and the lead-watch (P3.13) count calls and flagged answers from `counts()`. A torn final
// line (a crash mid-append) is ignored when reading and is not appended after.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { fsyncDir, mkdirDurable } from './durable-fs.js';

export interface CheckRecord {
  at: string;
  by: string;
  /** What the caller named; `ref` is set once the version resolved. */
  id: string;
  ref?: string;
  type?: string;
  ok: boolean;
  /** The refusal code of a call that did not run the checks. */
  code?: string;
  answers?: number;
  /** Answers failing at least one check. */
  flagged?: number;
  doc_failures?: number;
  per_check?: Record<string, number>;
}

export interface CheckCounts {
  calls: number;
  ran: number;
  refused: number;
  /** Calls that ran and found at least one flagged answer or document-level failure. */
  calls_flagging: number;
  flagged_answers: number;
  document_failures: number;
  /** Per checked version (`id@vN`): how many times it was checked and what the latest run found. */
  by_ref: Record<string, { calls: number; flagged: number; doc_failures: number }>;
}

export class CheckJournal {
  private tornTail?: boolean;

  constructor(readonly path: string) {}

  /** Every well-formed record, in order; a torn or damaged line is skipped. */
  records(): CheckRecord[] {
    if (!existsSync(this.path)) return [];
    const out: CheckRecord[] = [];
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as CheckRecord;
        if (r && typeof r.by === 'string' && typeof r.ok === 'boolean') out.push(r);
      } catch {
        /* a torn final line, or damage: it only costs a count */
      }
    }
    return out;
  }

  counts(): CheckCounts {
    const c: CheckCounts = {
      calls: 0,
      ran: 0,
      refused: 0,
      calls_flagging: 0,
      flagged_answers: 0,
      document_failures: 0,
      by_ref: {},
    };
    for (const r of this.records()) {
      c.calls++;
      if (!r.ok) {
        c.refused++;
        continue;
      }
      c.ran++;
      const f = r.flagged ?? 0;
      const d = r.doc_failures ?? 0;
      if (f || d) c.calls_flagging++;
      c.flagged_answers += f;
      c.document_failures += d;
      if (r.ref) {
        const x = c.by_ref[r.ref] ?? { calls: 0, flagged: 0, doc_failures: 0 };
        c.by_ref[r.ref] = { calls: x.calls + 1, flagged: f, doc_failures: d };
      }
    }
    return c;
  }

  /** Record one call durably. Throws on an I/O error (the caller then reports the call as failed). */
  append(r: CheckRecord): void {
    const fresh = !existsSync(this.path);
    if (fresh) mkdirDurable(dirname(this.path));
    if (this.tornTail === undefined)
      this.tornTail = !fresh && !readFileSync(this.path, 'utf8').endsWith('\n');
    const fd = openSync(this.path, 'a');
    try {
      writeSync(fd, `${this.tornTail ? '\n' : ''}${JSON.stringify(r)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (fresh) fsyncDir(dirname(this.path));
    this.tornTail = false;
  }
}
