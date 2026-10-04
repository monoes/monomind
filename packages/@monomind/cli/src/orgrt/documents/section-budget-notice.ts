// orgrt/documents/section-budget-notice.ts
//
// The durable section budget notices (org sections plan P4.6): the 80 percent warning and the closure notice that
// the section lead and the root get through the org's REAL deliver path (daemon.deliver as the runtime sender
// `org-docs`), one message per recipient per crossing.
//
// Durability, the P3.8 pattern with its own file (`<docs dir>/budget-notices.jsonl`, the same journal class): an
// OBLIGATION is journalled whole (recipient, subject, body) the moment a crossing is detected, before the first
// delivery attempt, so a crash between the crossing and the delivery still sends it at the next start; what became
// of each obligation (delivered or failed) is journalled after it. A crossing is identified by a stable key that
// names the scope and the allocation it crossed, so
//  - the same crossing is never owed twice, in this process or after a resume (`known` reads the journal);
//  - a reload that changes the allocation is a different crossing and can warn again.
// A failed delivery is retried at the next opportunity (the next usage event, a start, `retry()`), at most
// `maxFailures` times, then reported and left. Unlike a publication notice a delivered budget notice is not
// re-sent on a resume: nothing says whether the recipient "acted on" it, and a notice to a role whose mailbox is
// closed is queued to the durable inbox by the deliver path, from where the role takes it when it restarts.
import { join } from 'node:path';
import { type RuntimeDeliver, sendRuntimeMessage } from './deliver.js';
import { NoticeJournal, type OwedRecord } from './notice-journal.js';

export const DEFAULT_MAX_FAILURES = 5;
export const KIND_BUDGET_WARNING = 'section-budget-warning';
export const KIND_BUDGET_CLOSED = 'section-budget-closed';
export type BudgetNoticeKind = typeof KIND_BUDGET_WARNING | typeof KIND_BUDGET_CLOSED;

/** One crossing and the message it owes each recipient. */
export interface BudgetNoticeSpec {
  /** Names the crossing: `<warn|closed>:<scope>:<allocation>`. */
  crossing: string;
  kind: BudgetNoticeKind;
  /** Section name, `reserve` or `org`. */
  scope: string;
  recipients: readonly string[];
  subject: string;
  body: string;
}

export interface BudgetNoticeSink {
  deliver: RuntimeDeliver;
  /** Told of failures (the bus audit trail). */
  emit?: (e: { reason: string; msg: string; data: Record<string, unknown> }) => void;
}

export interface BudgetNoticeOptions {
  now?: () => Date;
  maxFailures?: number;
}

export type BudgetNoticeState = 'pending' | 'delivered' | 'exhausted';

export class SectionBudgetNotices {
  private readonly journal: NoticeJournal;
  private readonly memoryOwed: OwedRecord[] = [];
  private readonly deliveredHere = new Set<string>();
  private readonly maxFailures: number;
  private readonly now: () => Date;
  private sink: BudgetNoticeSink | undefined;
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  private queued = false;

  constructor(dir: string, opts: BudgetNoticeOptions = {}) {
    this.journal = new NoticeJournal(join(dir, 'budget-notices.jsonl'));
    this.maxFailures = opts.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.now = opts.now ?? (() => new Date());
  }

  private all(): OwedRecord[] {
    return [...this.journal.owed(), ...this.memoryOwed];
  }

  /** True once a crossing has been owed (journalled), in this run or an earlier one of the same run directory. */
  known(crossing: string): boolean {
    return this.all().some((o) => o.doc === crossing);
  }

  /** Journal the obligation of each recipient of a crossing that is not known yet, then schedule delivery. Returns
   *  true when the crossing was new. If a journal write fails the obligation is kept in memory only (sent by this
   *  process, lost with it). */
  owe(spec: BudgetNoticeSpec): boolean {
    if (this.known(spec.crossing)) return false;
    for (const to of new Set(spec.recipients)) {
      const rec: OwedRecord = {
        t: 'owed',
        key: `${spec.crossing}>${to}`,
        at: this.now().toISOString(),
        seq: this.all().length,
        kind: spec.kind,
        audience: 'lead',
        to,
        subject: spec.subject,
        body: spec.body,
        doc: spec.crossing,
        version: 0,
      };
      try {
        this.journal.append(rec);
      } catch {
        this.memoryOwed.push(rec);
      }
    }
    this.schedule();
    return true;
  }

  /** Attach the delivery path and send what was never delivered (a resume after a crash or a failure). */
  start(sink: BudgetNoticeSink): void {
    this.sink = sink;
    this.schedule();
  }

  /** The next opportunity for a failed or unsent notice. */
  retry(): Promise<void> {
    if (this.pending().length > 0) this.schedule();
    return this.chain;
  }

  /** Resolves when every delivery pass scheduled so far has finished. */
  idle(): Promise<void> {
    return this.chain;
  }

  close(): void {
    this.closed = true;
  }

  stateOf(o: OwedRecord): BudgetNoticeState {
    if (this.deliveredHere.has(o.key) || this.journal.state(o.key).deliveredAt) return 'delivered';
    return this.journal.state(o.key).failures >= this.maxFailures ? 'exhausted' : 'pending';
  }

  /** Every obligation recorded, in order, with what became of it. */
  records(): Array<OwedRecord & { state: BudgetNoticeState; failures: number }> {
    return this.all().map((o) => ({
      ...o,
      state: this.stateOf(o),
      failures: this.journal.state(o.key).failures,
    }));
  }

  /** The obligations not yet delivered and not given up on. */
  pending(): OwedRecord[] {
    return this.all().filter((o) => this.stateOf(o) === 'pending');
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    // a microtask: never inside the bus event that found the crossing, so a slow deliver cannot hold it
    this.chain = this.chain
      .then(() => {
        this.queued = false;
        return this.pass();
      })
      .catch(() => undefined);
  }

  private async pass(): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    const blocked = new Set<string>(); // recipients with an earlier notice that failed in this pass
    for (const o of this.pending()) {
      if (this.closed) return;
      if (blocked.has(o.to)) continue;
      const out = await sendRuntimeMessage(sink.deliver, o.to, o.subject, o.body);
      if (out.ok) {
        this.deliveredHere.add(o.key);
        this.record({
          t: 'delivered',
          key: o.key,
          at: this.now().toISOString(),
          receipt: out.receipt,
        });
        continue;
      }
      blocked.add(o.to);
      this.record({ t: 'failed', key: o.key, at: this.now().toISOString(), error: out.error });
      const failures = this.journal.state(o.key).failures;
      sink.emit?.({
        reason: `section-budget-notice-${failures >= this.maxFailures ? 'gave-up' : 'failed'}`,
        msg: `budget notice "${o.subject}" to ${o.to} was not delivered (${failures}/${this.maxFailures}): ${out.error}`,
        data: { key: o.key, to: o.to, failures, error: out.error },
      });
    }
  }

  private record(r: Parameters<NoticeJournal['append']>[0]): void {
    try {
      this.journal.append(r);
    } catch {
      /* not journalled: the obligation stays pending and is tried again (a repeat, never a loss) */
    }
  }
}
