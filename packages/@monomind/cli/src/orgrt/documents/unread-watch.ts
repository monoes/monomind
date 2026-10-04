// orgrt/documents/unread-watch.ts
//
// The pure decision of the unread-document watch (org sections spec 6.2 (f), R24, plan P3.13). A document
// version that was published for a consuming section's decision makers is a coordination failure when, within a
// bounded interval, either (a) the runtime GAVE UP delivering its publication notice (the runtime's own failure)
// or (b) the notice was delivered and no decision maker read the version. While a notice is merely pending
// (undelivered, or failing and still being retried) the watch is silent, as 6.2 (f) says ("no pending notice"):
// the retry is the remedy, and the clock of (b) starts at the delivery (P3.16a, open item 23).
// The watch tells the LEAD (the consumer's reports_to, else the root) once per episode, with the doubling gap
// and the cap of the existing lead-watch; it never writes to the consumer itself (that is the notice engine's job).
//
// This file only decides: it takes a snapshot and returns the notices to send, so it is table-testable without
// a daemon. unread-watch-run.ts builds the snapshot from the live run and sends what this returns.
import { MAX_NOTICES } from '../lead-watch.js';

export const DEFAULT_UNREAD_S = 120;

/** The interval in ms, or null when the org turned lead-watch (and so this watch) off. `unread_s` is seconds, fractions allowed. */
export function unreadIntervalMs(run: {
  lead_watch?: false | { unread_s?: number };
}): number | null {
  const c = run.lead_watch;
  if (c === false) return null;
  return (c?.unread_s ?? DEFAULT_UNREAD_S) * 1000;
}

export type NoticeDelivery = 'delivered' | 'pending' | 'exhausted';

export interface UnreadDecider {
  role: string;
  /** Who to tell, or undefined when nobody above it is running (nothing is sent, nothing is counted). */
  lead?: string;
  notice: NoticeDelivery;
  /** Failed delivery attempts of its notice. */
  failures: number;
  /** Where its clock runs from: the later of publish and delivery, never before the watch started. */
  since: number;
  /** It read the version or decided on it. */
  done: boolean;
}

export interface UnreadVersion {
  doc: string;
  version: number;
  type: string;
  producer: string;
  /** Still pending: not superseded, not accepted, not rejected. */
  open: boolean;
  deciders: UnreadDecider[];
}

export type UnreadCause = 'notice-gave-up' | 'not-read';

export interface UnreadNotice {
  /** The episode: one per version and lead. */
  key: string;
  lead: string;
  doc: string;
  version: number;
  type: string;
  producer: string;
  /** The decision makers that have not read it. */
  unread: string[];
  cause: UnreadCause;
  /** 1 for the first notice of the episode. */
  n: number;
  ageMs: number;
  text: string;
}

interface Episode {
  n: number;
  nextAt: number;
}

const span = (ms: number): string =>
  ms < 120_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;

const attempts = (n: number): string => `${n} failed ${n === 1 ? 'attempt' : 'attempts'}`;

function state(d: UnreadDecider): string {
  if (d.notice === 'delivered') return `${d.role} (told, no org_doc_read)`;
  return `${d.role} (the runtime gave up delivering its notice after ${attempts(d.failures)})`;
}

function text(v: UnreadVersion, who: UnreadDecider[], ageMs: number, n: number): string {
  const names = who.map((d) => `"${d.role}"`).join(', ');
  return (
    `[watch] Document "${v.doc}" v${v.version} (${v.type}, published by ${v.producer}) has gone unread for ${span(ageMs)}: ` +
    `${who.map(state).join('; ')}. Options: (1) wait; ` +
    `(2) nudge it: org_send to ${names} (the root may message any role; a role in another section cannot); ` +
    `(3) take over: reassign the review of this document to another role, or have the root read it. ` +
    `${n >= MAX_NOTICES ? 'This is the last notice for this episode.' : 'If nothing changes you get one more reminder after a longer gap.'}`
  );
}

export class UnreadWatch {
  private episodes = new Map<string, Episode>();

  constructor(private readonly intervalMs: number) {}

  /** A notice already sent (the bus history of a resumed run): the cap and the gap carry over. */
  seed(key: string, n: number, lastAt: number): void {
    this.episodes.set(key, { n, nextAt: lastAt + this.intervalMs * 2 ** n });
  }

  /**
   * `waiting`: a decision gate, approval or blocking question is pending (the lead-watch rule): nothing is sent
   * and no clock is reset. An episode ends, silently, when its version is superseded or decided or every
   * decision maker has read it, and it is forgotten.
   */
  tick(versions: UnreadVersion[], now: number, waiting: boolean): UnreadNotice[] {
    const out: UnreadNotice[] = [];
    const live = new Set<string>();
    for (const v of versions) {
      if (!v.open) continue;
      const byLead = new Map<string, UnreadDecider[]>();
      for (const d of v.deciders)
        if (!d.done && d.notice !== 'pending') byLead.set(d.lead ?? '', [...(byLead.get(d.lead ?? '') ?? []), d]);
      for (const [lead, who] of byLead) {
        const key = `${v.doc}@v${v.version}>${lead}`;
        live.add(key);
        const overdue = who.filter((d) => now - d.since >= this.intervalMs);
        if (!lead || waiting || overdue.length === 0) continue;
        const ep = this.episodes.get(key) ?? { n: 0, nextAt: 0 };
        this.episodes.set(key, ep);
        if (ep.n >= MAX_NOTICES || (ep.n > 0 && now < ep.nextAt)) continue;
        ep.n++;
        ep.nextAt = now + this.intervalMs * 2 ** ep.n;
        const ageMs = now - Math.min(...who.map((d) => d.since));
        out.push({
          key,
          lead,
          doc: v.doc,
          version: v.version,
          type: v.type,
          producer: v.producer,
          unread: who.map((d) => d.role),
          cause: overdue.some((d) => d.notice === 'exhausted') ? 'notice-gave-up' : 'not-read',
          n: ep.n,
          ageMs,
          text: text(v, who, ageMs, ep.n),
        });
      }
    }
    for (const k of [...this.episodes.keys()]) if (!live.has(k)) this.episodes.delete(k);
    return out;
  }
}
