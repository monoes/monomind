// orgrt/documents/notice-journal.ts
//
// The durable delivery journal of the publication notices (org sections plan P3.8): `<docs dir>/notices.jsonl`,
// one JSON line per delivery outcome, appended and fsynced before the engine goes on. A notice OBLIGATION is
// derived from the committed event log (notice.ts), so it cannot be lost; this journal only records what became
// of each obligation. Losing a line errs on the safe side: a lost `delivered` line means one more delivery after
// a restart, a lost `failed` line means one more retry. A torn final line is ignored and not appended after.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { fsyncDir, mkdirDurable } from './durable-fs.js';

export type JournalRecord =
  | { t: 'delivered'; key: string; at: string; receipt: string; again?: true; adopted?: true }
  | { t: 'failed'; key: string; at: string; error: string };

export interface KeyState {
  deliveredAt?: string;
  /** Failed delivery attempts recorded for the key (it is delivered or exhausted once this reaches the bound). */
  failures: number;
  lastError?: string;
  redeliveries: number;
}

export class NoticeJournal {
  private readonly states = new Map<string, KeyState>();
  private tornTail = false;

  constructor(readonly path: string) {
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf8');
    if (text.length > 0 && !text.endsWith('\n')) this.tornTail = true;
    const lines = text.split('\n');
    if (this.tornTail) lines.pop(); // the unterminated tail is a torn write
    for (const line of lines) {
      let r: Partial<JournalRecord> | undefined;
      try {
        r = JSON.parse(line) as Partial<JournalRecord>;
      } catch {
        continue; // a damaged line only costs a repeat
      }
      if (r && typeof r.key === 'string' && (r.t === 'delivered' || r.t === 'failed'))
        this.apply(r as JournalRecord);
    }
  }

  state(key: string): KeyState {
    return this.states.get(key) ?? { failures: 0, redeliveries: 0 };
  }

  private apply(r: JournalRecord): void {
    const s = this.states.get(r.key) ?? { failures: 0, redeliveries: 0 };
    if (r.t === 'delivered') {
      s.deliveredAt = r.at;
      if (r.again) s.redeliveries += 1;
    } else {
      s.failures += 1;
      s.lastError = r.error;
    }
    this.states.set(r.key, s);
  }

  /** Record one outcome durably. Throws on an I/O error; the in-memory state is then left unchanged. */
  append(r: JournalRecord): void {
    const fresh = !existsSync(this.path);
    if (fresh) mkdirDurable(dirname(this.path));
    const fd = openSync(this.path, 'a');
    try {
      writeSync(fd, `${this.tornTail ? '\n' : ''}${JSON.stringify(r)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (fresh) fsyncDir(dirname(this.path));
    this.tornTail = false;
    this.apply(r);
  }
}
