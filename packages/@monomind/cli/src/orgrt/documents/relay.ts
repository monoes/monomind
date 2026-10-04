// orgrt/documents/relay.ts
//
// The producer relay (org sections open item 17, R24's other direction, plan P3.9), as pure functions over the
// committed event log and the contracts. When a consumer REJECTS a version, or an ACCEPT is refused because the
// producer's deliverable files changed, the runtime itself tells the producing role (no lead has to pass it on),
// and sends a short copy to the producing section's lead (the root when the producer is the lead).
//
//  - a rejection obligation is DERIVED from a committed `decided` event (reject), exactly like a publish notice,
//    so a commit always owes its relay and a crash cannot lose one;
//  - a changed-deliverable obligation has no committed event (a refused accept commits nothing), so it is built
//    at the moment of the refusal and journalled whole (notice-journal.ts `owed`) before any delivery;
//  - both ride the NoticeEngine's delivery machinery (notices.ts): retry, give-up, resume re-delivery, adoption of
//    a message still in the recipient's mailbox. This file only says WHAT is owed and WHAT it says.
//
// The text follows the harness prototype (tests/eval/org/pilot/relay.ts, measured in sweep-3 v2) with the runtime
// tool names. It is built only from the contract, the event fields and the consumer's own reason (cut at
// REASON_CAP characters): nothing from any fault, seed or injection record. Differences from the prototype: the
// contract is named by type and revision (a runtime contract has no title); "publish attempts" are the store's
// own counter (publishes the store refused, per type and contract revision), not the number of versions;
// rework rounds and the consumer section are stated; the republish names the version it supersedes.
import { createHash } from 'node:crypto';
import type { DeliverableChange } from './deliverable-guards.js';
import { KIND_CHANGED, KIND_REJECTED, type Notice } from './notice.js';
import type { DocumentStore } from './store.js';
import type { StoreEvent } from './store-types.js';

/** The consumer's reason is relayed verbatim up to this many characters, then cut with a marker. */
export const REASON_CAP = 600;
/** The copy to the lead carries a shorter cut. */
export const COPY_REASON_CAP = 200;

export type RelayType = ReturnType<DocumentStore['contracts']>[number];
/** Who gets the short copy for a type produced by `section`: its lead, else the root; never the producer. */
export type CopyTo = (section: string, producer: string) => string | undefined;

type Published = Extract<StoreEvent, { type: 'published' }>;

/** A reason, verbatim, or its first `cap` characters followed by a marker that says it was cut. */
export function capReason(reason: string, cap: number): string {
  if (reason.length <= cap) return reason;
  let cut = reason.slice(0, cap);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1); // never half a surrogate pair
  return `${cut}… [cut at ${cap} characters; the whole reason is in the decisions of org_doc_read]`;
}

const rev = (r: string): string => r.slice(0, 12);

function attemptsLine(t: RelayType, used: number): { line: string; left: number } {
  const max = t.contract.max_publish_attempts;
  const left = Math.max(max - used, 0);
  return {
    left,
    line:
      left > 0
        ? `Publish attempts for "${t.type}": ${used} of ${max} used, ${left} left (each publish the store refuses uses one).`
        : `All ${max} publish attempts for "${t.type}" are used, so no further publish of this type will be accepted: your section lead must take over.`,
  };
}

function build(
  base: Pick<Notice, 'kind' | 'seq' | 'doc' | 'version'>,
  key: string,
  to: string,
  audience: 'producer' | 'lead',
  subject: string,
  body: string,
): Notice {
  return { ...base, key: `${key}:${audience}`, audience, to, subject, body };
}

/** Every rejection relay the committed log obliges, in order (producer first, then the copy). */
export function deriveRelays(
  types: readonly RelayType[],
  events: readonly StoreEvent[],
  copyTo?: CopyTo,
): Notice[] {
  const byType = new Map(types.map((t) => [t.type, t]));
  const out: Notice[] = [];
  const published = new Map<string, Published>(); // doc@version
  const used = new Map<string, number>(); // `${type}|${revision}` -> counted publish refusals so far
  const rework = new Map<string, number>(); // `${doc}|${consumer}` -> rejections so far
  for (const e of events) {
    if (e.type === 'published') published.set(`${e.doc}@${e.version}`, e);
    else if (e.type === 'refused') {
      if (e.op === 'publish' && e.counts === 'attempt') {
        const k = `${e.doc_type}|${e.contract_revision}`;
        used.set(k, (used.get(k) ?? 0) + 1);
      }
    } else if (e.type === 'decided' && e.decision === 'reject') {
      const rk = `${e.doc}|${e.consumer}`;
      rework.set(rk, (rework.get(rk) ?? 0) + 1);
      const p = published.get(`${e.doc}@${e.version}`);
      const t = p && byType.get(p.doc_type);
      if (!p || !t) continue;
      const { line, left } = attemptsLine(t, used.get(`${t.type}|${e.contract_revision}`) ?? 0);
      const many = t.consumers.length > 1 ? ` (${e.consumer})` : '';
      const subject = `document rejected: ${e.doc} v${e.version}${many}`;
      const files = t.contract.deliverable_files.map((d) => d.file);
      const base = { kind: KIND_REJECTED, seq: e.seq, doc: e.doc, version: e.version } as const;
      const rounds = rework.get(rk) ?? 1;
      const reason = e.reason ?? '';
      out.push(
        build(
          base,
          `r:${e.seq}`,
          p.by,
          'producer',
          subject,
          [
            `${e.by} (${e.consumer}) rejected version ${e.version} of document "${e.doc}" (contract: ${t.type} ${rev(e.contract_revision)}).`,
            `Reason given: ${capReason(reason, REASON_CAP)}`,
            `Rework rounds so far for this document from ${e.consumer}: ${rounds}.`,
            line,
            `What to do: check the underlying deliverable${files.length ? ` (${files.join(', ')})` : ''} against the code and fix it if the reason holds, then publish a corrected version with org_doc_publish (supersedes: "${e.doc}@v${e.version}"); it replaces the rejected one. If you are sure the reason is wrong, publish the same content again with a short note (the note argument of org_doc_publish) saying why.`,
          ].join(' '),
        ),
      );
      const lead = copyTo?.(t.section, p.by);
      if (lead && lead !== p.by)
        out.push(
          build(
            base,
            `r:${e.seq}`,
            lead,
            'lead',
            `${subject} (copy)`,
            `${e.by} rejected ${e.doc} v${e.version}: ${capReason(reason, COPY_REASON_CAP)} (${p.by} was notified directly, no relay needed; publish attempts left ${left}${left === 0 ? ', the section lead must take over' : ''}).`,
          ),
        );
    }
  }
  return out;
}

const shown = (ps: readonly string[]): string =>
  ps.length > 1 ? ` (and ${ps.length - 1} more)` : '';

/**
 * The relays owed for an accept refused because the producer's deliverable files changed. The key names the
 * version and the problems, so a consumer that retries the accept while the files still differ is not relayed
 * again, and a different difference is.
 */
export function changedRelays(
  c: DeliverableChange,
  t: RelayType,
  seq: number,
  copyTo?: CopyTo,
): Notice[] {
  const first = capReason(c.problems[0] ?? 'a deliverable file differs', 300);
  const files = [...new Set(c.files)].join(', ');
  const sha = createHash('sha256').update(c.problems.join('\n')).digest('hex').slice(0, 10);
  const key = `c:${c.doc}@${c.version}:${sha}`;
  const base = { kind: KIND_CHANGED, seq, doc: c.doc, version: c.version } as const;
  const subject = `document needs republishing: ${c.doc} v${c.version}`;
  const out = [
    build(
      base,
      key,
      c.producer,
      'producer',
      subject,
      `Version ${c.version} of document "${c.doc}" (contract: ${c.type} ${rev(t.revision)}) could not be accepted by ${c.decider} (${c.consumer}) because your deliverable files changed after you published it: ${files}. First difference: ${first}${shown(c.problems)}. Publish a corrected version with org_doc_publish (supersedes: "${c.doc}@v${c.version}") so the document and the files agree.`,
    ),
  ];
  const lead = copyTo?.(t.section, c.producer);
  if (lead && lead !== c.producer)
    out.push(
      build(
        base,
        key,
        lead,
        'lead',
        `${subject} (copy)`,
        `${c.decider} could not accept ${c.doc} v${c.version}: the deliverable files of ${c.producer} changed after publishing (${files}); ${c.producer} was notified directly to republish, no relay needed.`,
      ),
    );
  return out;
}

/** What lead-watch (P3.13) needs of one producer relay. */
export interface RelayFact {
  kind: typeof KIND_REJECTED | typeof KIND_CHANGED;
  doc: string;
  version: number;
  producer: string;
  key: string;
  state: 'pending' | 'delivered' | 'exhausted';
  /** When the relay to the producer was delivered. */
  delivered_at?: string;
  failures: number;
  /** The first version of the document published after the rejected one, and when (the producer's reaction). */
  republished_version?: number;
  republished_at?: string;
  copies: { to: string; state: 'pending' | 'delivered' | 'exhausted'; delivered_at?: string }[];
}

/** One fact per relay to a producer, in order; `stateOf` and `deliveredAt` come from the delivery journal. */
export function relayFacts(
  notices: readonly Notice[],
  events: readonly StoreEvent[],
  stateOf: (n: Notice) => RelayFact['state'],
  info: (n: Notice) => { deliveredAt?: string; failures: number },
): RelayFact[] {
  const relays = notices.filter((n) => n.kind === KIND_REJECTED || n.kind === KIND_CHANGED);
  return relays
    .filter((n) => n.audience === 'producer')
    .map((n) => {
      const later = events.find(
        (e): e is Published => e.type === 'published' && e.doc === n.doc && e.version > n.version,
      );
      const i = info(n);
      return {
        kind: n.kind as RelayFact['kind'],
        doc: n.doc,
        version: n.version,
        producer: n.to,
        key: n.key,
        state: stateOf(n),
        ...(i.deliveredAt ? { delivered_at: i.deliveredAt } : {}),
        failures: i.failures,
        ...(later ? { republished_version: later.version, republished_at: later.at } : {}),
        copies: relays
          .filter((c) => c.audience === 'lead' && c.key.slice(0, -5) === n.key.slice(0, -9))
          .map((c) => {
            const ci = info(c);
            return {
              to: c.to,
              state: stateOf(c),
              ...(ci.deliveredAt ? { delivered_at: ci.deliveredAt } : {}),
            };
          }),
      };
    });
}
