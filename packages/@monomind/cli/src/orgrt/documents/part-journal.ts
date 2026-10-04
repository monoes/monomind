// orgrt/documents/part-journal.ts
//
// Which parts of a version each role has read (org sections plan P3.16b). The event log records only the first
// page of a read (a `read` event, P3.5), and a part after the first is served without a new event so that the
// document's state_seq and the closed event union stay as they are. The rule "decide only after reading every
// part" needs every part, so it is kept in a SIBLING journal of the event log, like the check journal (P3.11):
// `<docs dir>/part-reads.jsonl`, one JSON line per successful org_doc_read call, appended and fsynced before the
// call returns. It changes no document state; a lost or torn line only means the role reads that part again.
// The index lives in memory and is rebuilt from the file at construction (a resumed run keeps its reads).
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { fsyncDir, mkdirDurable } from './durable-fs.js';

export interface PartRead {
  at: string;
  by: string;
  doc: string;
  version: number;
  part: number;
  parts: number;
}

const keyOf = (by: string, doc: string, version: number): string => `${by}|${doc}@${version}`;

export class PartJournal {
  private readonly seen = new Map<string, Set<number>>();
  private tornTail?: boolean;

  constructor(readonly path: string) {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as PartRead;
        if (typeof r.by === 'string' && typeof r.doc === 'string') this.index(r);
      } catch {
        /* a torn final line, or damage: the part is read again */
      }
    }
  }

  private index(r: PartRead): void {
    const k = keyOf(r.by, r.doc, r.version);
    this.seen.set(k, (this.seen.get(k) ?? new Set<number>()).add(r.part));
  }

  /** The parts of one version `by` has read, ascending. */
  partsRead(by: string, doc: string, version: number): number[] {
    return [...(this.seen.get(keyOf(by, doc, version)) ?? [])].sort((a, b) => a - b);
  }

  /** Record one read. The index is updated first; a failed write only costs a repeat read after a restart. */
  record(r: PartRead): void {
    this.index(r);
    try {
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
    } catch {
      /* not journalled */
    }
  }
}
