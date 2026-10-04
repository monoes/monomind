// orgrt/documents/notices.ts
//
// The publication notice engine (org sections spec 6.2 (a) to (e), R24, plan P3.8). One per documents runtime.
//
// What it does: after every committed publish (each version, a republish included) the runtime itself, with no
// role action, sends each decision maker of a consuming section one system message through the REAL deliver
// path (daemon.deliver as the runtime sender `org-docs`), which starts a pending role and wakes an idle one; and
// once per decision maker, after the publish that completes the set of documents it needs, one all-available
// message.
//
// Durability (the design): the obligations are derived from the committed event log (notice.ts), so a publish
// that committed always owes its notices, with no window in which a crash could lose them. What became of each
// obligation is journalled in `notices.jsonl` (notice-journal.ts). Delivery runs after the commit, off the
// publisher's call stack, and never throws into it. A failed delivery is journalled and retried at the next
// opportunity (the next publish, `retry()`, a start), at most `maxFailures` times, then reported and left.
// At start (a run resumes) every obligation without a delivered record is sent once, and a notice that WAS
// delivered but whose document version the decision maker has not read or decided is sent again unless the
// recipient's restored mailbox still holds it: the Mailbox drops its oldest item at 500, and a checkpoint can
// miss the last items, so a delivered record alone is not proof the message is still there.
import { join } from 'node:path';
import { type RuntimeDeliver, sendRuntimeMessage } from './deliver.js';
import type { DeliverableChange } from './deliverable-guards.js';
import { EventLog, parseLog } from './events.js';
import {
  deriveNotices,
  KIND_CHANGED,
  KIND_PUBLISHED,
  KIND_REJECTED,
  type Notice,
  type TypeInfo,
} from './notice.js';
import { NoticeJournal } from './notice-journal.js';
import { type CopyTo, changedRelays, deriveRelays, type RelayFact, relayFacts } from './relay.js';
import type { DocumentStore } from './store.js';
import type { StoreEvent } from './store-types.js';

export const DEFAULT_MAX_FAILURES = 5;

export interface NoticeSink {
  deliver: RuntimeDeliver;
  /** True when the recipient's live mailbox still holds a message with this subject (it is not re-sent). */
  queued?: (to: string, subject: string) => boolean;
  /** Told of failures and re-deliveries (the bus audit trail). */
  emit?: (e: { reason: string; msg: string; data: Record<string, unknown> }) => void;
}

export interface NoticeEngineOptions {
  /** `<orgDir>/docs/<run>`. */
  dir: string;
  store: DocumentStore;
  now?: () => Date;
  maxFailures?: number;
  /** Producer relay (P3.9): who gets the short copy of a relay for a type produced by a section. */
  copyTo?: CopyTo;
}

const labelOf = (n: Notice): 'notice' | 'relay' =>
  n.kind === KIND_REJECTED || n.kind === KIND_CHANGED ? 'relay' : 'notice';

export type NoticeState = 'pending' | 'delivered' | 'exhausted';

/** What lead-watch (P3.13) needs of one published version: when it was published, whether and when each
 *  decision maker was told, and when each first read it. */
export interface DocFact {
  doc: string;
  version: number;
  type: string;
  published_at: string;
  notices: {
    role: string;
    key: string;
    state: NoticeState;
    delivered_at?: string;
    failures: number;
  }[];
  first_read_at: Record<string, string>;
}

export class NoticeEngine {
  private readonly journal: NoticeJournal;
  private readonly events: StoreEvent[];
  private readonly maxFailures: number;
  private readonly now: () => Date;
  private derived: Notice[] | undefined;
  private sink: NoticeSink | undefined;
  private enabled = true;
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  private queuedPass: 'plain' | 'start' | undefined;
  private readonly memoryOwed: Notice[] = [];
  private readonly unsubscribe: () => void;

  constructor(private readonly opts: NoticeEngineOptions) {
    this.maxFailures = opts.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.now = opts.now ?? (() => new Date());
    this.journal = new NoticeJournal(join(opts.dir, 'notices.jsonl'));
    this.events = parseLog(EventLog.read(join(opts.dir, 'events.jsonl'))).events;
    this.unsubscribe = opts.store.onCommitted((e) => {
      this.events.push(e);
      if (e.type !== 'published' && !(e.type === 'decided' && e.decision === 'reject')) return;
      this.derived = undefined;
      this.schedule('plain');
    });
  }

  /** Test-only switch: with notices off nothing is sent and the obligations stay pending (the deadlock regression). */
  setEnabledForTest(on: boolean): void {
    this.enabled = on;
  }

  /** Attach the delivery path and run the start pass: send what was never delivered, re-send what was not acted on. */
  start(sink: NoticeSink): void {
    this.sink = sink;
    this.schedule('start');
  }

  /** The next opportunity for a failed or unsent notice (the lead-watch tick of P3.13 calls this). */
  retry(): Promise<void> {
    this.schedule('plain');
    return this.chain;
  }

  /** Resolves when every delivery pass scheduled so far has finished. */
  idle(): Promise<void> {
    return this.chain;
  }

  close(): void {
    this.closed = true;
    this.unsubscribe();
  }

  private types(): TypeInfo[] {
    return this.opts.store.contracts().map((c) => ({
      type: c.type,
      hasChecks: c.contract.checks.length > 0,
      consumers: c.consumers,
    }));
  }

  /** Every notice and relay the committed log (and the journalled refused accepts) oblige, in order. */
  notices(): Notice[] {
    this.derived ??= this.derive();
    return this.derived;
  }

  private derive(): Notice[] {
    const own = deriveNotices(this.types(), this.events);
    const relays = deriveRelays(this.opts.store.contracts(), this.events, this.opts.copyTo);
    const owed: Notice[] = this.journal.owed().map((o) => ({
      key: o.key,
      kind: o.kind as Notice['kind'],
      audience: o.audience,
      to: o.to,
      seq: o.seq,
      doc: o.doc,
      version: o.version,
      subject: o.subject,
      body: o.body,
    }));
    // by the sequence of the committed event behind each; a stable sort keeps the derivation order within one
    return [...own, ...relays, ...owed, ...this.memoryOwed]
      .map((n, i) => ({ n, i }))
      .sort((a, b) => a.n.seq - b.n.seq || a.i - b.i)
      .map((x) => x.n);
  }

  /**
   * A refused accept (deliverable files changed, P3.10) has no committed event, so its relay obligation is
   * journalled whole the moment the guard refuses, before any delivery: a crash after this line still sends it
   * at the next start, and a crash before it means the consumer never got the refusal either (it will retry).
   * One relay per version and difference. If the journal write fails the obligation is kept in memory only (sent
   * by this process, lost with it).
   */
  owe(c: DeliverableChange): void {
    const t = this.opts.store.contracts().find((x) => x.type === c.type);
    if (!t) return;
    const seq = this.opts.store.info().seq;
    for (const n of changedRelays(c, t, seq, this.opts.copyTo)) {
      if (this.journal.owed().some((o) => o.key === n.key)) continue;
      try {
        this.journal.append({
          t: 'owed',
          key: n.key,
          at: this.at(),
          seq,
          kind: n.kind,
          audience: n.audience as 'producer' | 'lead',
          to: n.to,
          subject: n.subject,
          body: n.body,
          doc: n.doc,
          version: n.version,
        });
      } catch {
        this.memoryOwed.push(n);
      }
    }
    this.derived = undefined;
    this.schedule('plain');
  }

  /** Per producer relay: when it was delivered and whether and when the producer republished (P3.13). */
  relayFacts(): RelayFact[] {
    return relayFacts(
      this.notices(),
      this.events,
      (n) => this.stateOf(n),
      (n) => this.journal.state(n.key),
    );
  }

  private stateOf(n: Notice): NoticeState {
    const s = this.journal.state(n.key);
    if (s.deliveredAt) return 'delivered';
    return s.failures >= this.maxFailures ? 'exhausted' : 'pending';
  }

  /** The notices not yet delivered and not given up on. */
  pending(): Notice[] {
    return this.notices().filter((n) => this.stateOf(n) === 'pending');
  }

  /** Per published version: the facts lead-watch needs. */
  facts(): DocFact[] {
    const notices = this.notices();
    const out: DocFact[] = [];
    for (const e of this.events) {
      if (e.type !== 'published') continue;
      const mine = notices.filter((n) => n.kind === KIND_PUBLISHED && n.seq === e.seq);
      const firstRead: Record<string, string> = {};
      for (const r of this.events)
        if (r.type === 'read' && r.doc === e.doc && r.version === e.version && !firstRead[r.by])
          firstRead[r.by] = r.at;
      out.push({
        doc: e.doc,
        version: e.version,
        type: e.doc_type,
        published_at: e.at,
        notices: mine.map((n) => {
          const s = this.journal.state(n.key);
          return {
            role: n.to,
            key: n.key,
            state: this.stateOf(n),
            ...(s.deliveredAt ? { delivered_at: s.deliveredAt } : {}),
            failures: s.failures,
          };
        }),
        first_read_at: firstRead,
      });
    }
    return out;
  }

  private schedule(pass: 'plain' | 'start'): void {
    if (this.queuedPass) {
      if (pass === 'start') this.queuedPass = 'start';
      return;
    }
    this.queuedPass = pass;
    // a microtask: never inside the commit that called the listener, so a slow deliver cannot hold a publish
    this.chain = this.chain
      .then(() => {
        const p = this.queuedPass as 'plain' | 'start';
        this.queuedPass = undefined;
        return this.pass(p === 'start');
      })
      .catch(() => undefined);
  }

  /** True when `n`'s decision maker has read or decided that document version (or a later one). */
  private acted(n: Notice): boolean {
    return this.events.some(
      (e) =>
        (e.type === 'read' || e.type === 'decided') &&
        e.by === n.to &&
        e.doc === n.doc &&
        e.version >= n.version,
    );
  }

  private headVersion(doc: string): number {
    let v = 0;
    for (const e of this.events)
      if (e.type === 'published' && e.doc === doc) v = Math.max(v, e.version);
    return v;
  }

  /** A delivered obligation worth sending again at a start: the recipient has not acted on it. A publish notice
   *  stands until its decision maker reads or decides that version; a relay until the producer publishes again. */
  private resendable(n: Notice): boolean {
    if (n.kind === KIND_PUBLISHED) return n.version === this.headVersion(n.doc) && !this.acted(n);
    if (n.kind === KIND_REJECTED || n.kind === KIND_CHANGED)
      return n.audience === 'producer' && n.version === this.headVersion(n.doc);
    return false;
  }

  /** The instruction to the producer is moot once it has replaced the version; the copy to the lead is an audit
   *  record and is still sent. */
  private moot(n: Notice): boolean {
    return (
      n.audience === 'producer' &&
      (n.kind === KIND_REJECTED || n.kind === KIND_CHANGED) &&
      this.headVersion(n.doc) > n.version
    );
  }

  private async pass(start: boolean): Promise<void> {
    const sink = this.sink;
    if (!sink || !this.enabled) return;
    const blocked = new Set<string>(); // recipients with an earlier notice that failed in this pass
    for (const n of [...this.notices()]) {
      if (this.closed) return;
      if (blocked.has(n.to)) continue;
      const s = this.journal.state(n.key);
      let again = false;
      if (s.deliveredAt) {
        again = start && this.resendable(n);
        if (!again) continue;
      } else if (s.failures >= this.maxFailures) continue;
      if (!s.deliveredAt && this.moot(n)) {
        // a relay about a version the producer already replaced: nothing to say any more
        this.record({
          t: 'delivered',
          key: n.key,
          at: this.at(),
          receipt: 'moot: version superseded',
          adopted: true,
        });
        continue;
      }
      if (sink.queued?.(n.to, n.subject)) {
        if (!s.deliveredAt)
          this.record({
            t: 'delivered',
            key: n.key,
            at: this.at(),
            receipt: 'already queued',
            adopted: true,
          });
        continue;
      }
      const out = await sendRuntimeMessage(sink.deliver, n.to, n.subject, n.body);
      if (out.ok) {
        this.record({
          t: 'delivered',
          key: n.key,
          at: this.at(),
          receipt: out.receipt,
          ...(again ? { again: true as const } : {}),
        });
        if (again)
          sink.emit?.({
            reason: `doc-${labelOf(n)}-resent`,
            msg: `re-sent the ${labelOf(n)} "${n.subject}" to ${n.to}: delivered earlier, not yet acted on`,
            data: { key: n.key, to: n.to },
          });
        continue;
      }
      blocked.add(n.to);
      this.record({ t: 'failed', key: n.key, at: this.at(), error: out.error });
      const failures = this.journal.state(n.key).failures;
      sink.emit?.({
        reason: `doc-${labelOf(n)}-${failures >= this.maxFailures ? 'gave-up' : 'failed'}`,
        msg: `${labelOf(n)} "${n.subject}" to ${n.to} was not delivered (${failures}/${this.maxFailures}): ${out.error}`,
        data: { key: n.key, to: n.to, failures, error: out.error },
      });
    }
  }

  private at(): string {
    return this.now().toISOString();
  }

  private record(r: Parameters<NoticeJournal['append']>[0]): void {
    try {
      this.journal.append(r);
    } catch {
      /* not journalled: the obligation stays pending and is tried again (a repeat, never a loss) */
    }
  }
}
