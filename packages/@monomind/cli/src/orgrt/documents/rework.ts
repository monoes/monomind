// orgrt/documents/rework.ts
//
// `max_rework_rounds` enforced (org sections spec 6.5 and 13.2, plan P4.7), the facts and the escalation notice.
// Pure functions over the document state and the committed event log; nothing here reads the clock or the disk.
//
//  - A THREAD is one document and one consuming section; its rounds are the versions that section rejected
//    (loop-rounds.ts: reworkThreads). It is EXHAUSTED when the rounds reach the section's cap (a cap of 2: the
//    second rejection exhausts). A thread is FROZEN while it is exhausted and the head of the document is not
//    accepted: a publish that supersedes the document is refused (rework-guard.ts). Frozen is derived from the
//    state and the CURRENT caps every time, never stored, so a reload that raises a cap thaws the thread and one
//    that lowers it freezes it.
//  - The escalation NOTICE is derived from the committed log: at each committed rejection that brings a thread to
//    its cap, the root and the leads of the producing and consuming sections (the producer itself is told by its
//    relay) are owed one message. The key names the thread, the cap and the event, so a replay derives the same
//    key, and a thread that is exhausted again after the root accepted it is a new obligation.
//  - `syncReworkCaps` carries a changed `max_rework_rounds` from a reloaded definition into the running one.

import type { ReworkThread } from './loop-rounds.js';
import { capsFromDef, reworkThreads } from './loop-rounds.js';
import { KIND_EXHAUSTED, type Notice } from './notice.js';
import { COPY_REASON_CAP, capReason, REASON_CAP } from './relay.js';
import { applyEvent, type DocState, emptyState, headOf, versionStatus } from './state.js';
import type { StoreEvent } from './store-types.js';

export type ReworkCaps = Readonly<Record<string, number | undefined>>;
export { capsFromDef };

/** What the notice engine needs of the enforcement: the caps now, and who is told. */
export interface ReworkEscalation {
  caps(): ReworkCaps;
  /** The root: it gets the full notice; the other recipients get the short copy. */
  root: string | undefined;
  /** The roles owed the exhaustion notice for a thread, in order, without repeats. */
  recipients(t: ReworkThread): string[];
}

export interface ReworkFact extends ReworkThread {
  /** Exhausted and the head is not accepted: a publish superseding the document is refused. */
  frozen: boolean;
  /** The head version the root may decide. */
  head: number;
}

/** Every thread with a rejection and a cap, each with whether it is frozen. A pure function of the state and the caps. */
export function reworkFacts(state: DocState, caps: ReworkCaps): ReworkFact[] {
  return reworkThreads(state, caps).map((t) => {
    const d = state.docs[t.doc];
    const h = headOf(d);
    return { ...t, head: h.version, frozen: t.exhausted && versionStatus(d, h) !== 'accepted' };
  });
}

/** The frozen threads of one document. */
export const frozenThreads = (state: DocState, caps: ReworkCaps, doc: string): ReworkFact[] =>
  reworkFacts(state, caps).filter((f) => f.frozen && f.doc === doc);

/** The consuming section the root may decide for on `doc` version `version`: that of a frozen thread whose head it is. */
export const rootMayDecide = (
  state: DocState,
  caps: ReworkCaps,
  doc: string,
  version: number,
): string | undefined => frozenThreads(state, caps, doc).find((f) => f.head === version)?.consumer;

function rootText(
  t: ReworkThread,
  by: string,
  version: number,
  reason: string,
): { subject: string; body: string } {
  return {
    subject: `rework exhausted: ${t.doc} (${t.consumer})`,
    body: [
      `The review cycle of document "${t.doc}" (type ${t.type}) is spent: ${t.consumer} has rejected ${t.rounds} versions of it, which is its cap of ${t.cap} rework rounds (sections.${t.consumer}.max_rework_rounds).`,
      `Last rejection: version ${version}, by ${by}: ${capReason(reason, REASON_CAP)}`,
      `The thread is frozen: the producer cannot publish a revision of it, and was told to wait for you.`,
      `You decide. Options: (1) raise the cap: set sections.${t.consumer}.max_rework_rounds higher in the org definition and reload it, and the producer may revise again; (2) decide the document yourself: org_doc_decide on ${t.doc} version ${version} with decision "accept" (it replaces ${t.consumer}'s rejection and ends the thread); (3) reassign the work to another role or section; (4) close the thread: leave it frozen (org_doc_decide with decision "reject" confirms the rejection).`,
    ].join(' '),
  };
}

function leadText(
  t: ReworkThread,
  by: string,
  version: number,
  reason: string,
): { subject: string; body: string } {
  return {
    subject: `rework exhausted: ${t.doc} (${t.consumer}) (copy)`,
    body: `The review cycle of document "${t.doc}" is spent: ${t.consumer} rejected ${t.rounds} versions, its cap of ${t.cap} rework rounds. Last rejection (version ${version}, ${by}): ${capReason(reason, COPY_REASON_CAP)} The thread is frozen and the root decides; the producer was told to wait. Do not publish or decide it again.`,
  };
}

/**
 * The exhaustion notices the committed log obliges under `esc.caps()`, in order: at each committed rejection that
 * brings a thread to its cap, one notice per recipient. Replays the log, so it is deterministic.
 */
export function deriveReworkNotices(
  events: readonly StoreEvent[],
  esc: ReworkEscalation,
): Notice[] {
  const caps = esc.caps();
  if (Object.values(caps).every((c) => c === undefined)) return [];
  const state = emptyState();
  const out: Notice[] = [];
  for (const e of events) {
    try {
      applyEvent(state, e);
    } catch {
      break; // a corrupt log stops the store; nothing more can be derived
    }
    if (e.type !== 'decided' || e.decision !== 'reject' || e.override) continue;
    const t = reworkThreads(state, caps).find((x) => x.doc === e.doc && x.consumer === e.consumer);
    if (!t || t.rounds !== t.cap) continue;
    const reason = e.reason ?? '';
    const root = rootText(t, e.by, e.version, reason);
    const lead = leadText(t, e.by, e.version, reason);
    for (const to of esc.recipients(t))
      out.push({
        key: `x:${t.doc}|${t.consumer}|${t.cap}@${e.seq}:${to}`,
        kind: KIND_EXHAUSTED,
        ...(to === esc.root ? {} : { audience: 'lead' as const }),
        to,
        seq: e.seq,
        doc: t.doc,
        version: e.version,
        ...(to === esc.root ? root : lead),
      });
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copy each existing section's `max_rework_rounds` from the proposed definition into the running one; returns the
 *  `changed` entries. Only the cap moves: the rest of `sections` is not reloadable here. */
export function syncReworkCaps(
  live: { sections?: unknown },
  next: { sections?: unknown },
): string[] {
  if (!isObject(live.sections) || !isObject(next.sections)) return [];
  const changed: string[] = [];
  for (const [name, sec] of Object.entries(next.sections)) {
    const target = live.sections[name];
    if (!isObject(target) || !isObject(sec) || target.max_rework_rounds === sec.max_rework_rounds)
      continue;
    if (sec.max_rework_rounds === undefined) delete target.max_rework_rounds;
    else target.max_rework_rounds = sec.max_rework_rounds;
    changed.push(`sections.${name}.max_rework_rounds`);
  }
  return changed;
}

/** What a reload needs of the documents runtime. */
export interface ReworkHost {
  enableRework(): void;
  notices?: { retry(): Promise<void> };
}

/** A reload: carry the changed caps into the running definition, install the enforcement if a cap now exists, and
 *  give the notice engine a pass (a lowered cap can owe a notice). Returns the `changed` entries. */
export function reloadReworkCaps(
  live: { sections?: unknown },
  next: { sections?: unknown },
  docs: ReworkHost | undefined,
): string[] {
  const changed = syncReworkCaps(live, next);
  if (!docs || changed.length === 0) return changed;
  if (Object.keys(capsFromDef(live)).length > 0) docs.enableRework();
  void docs.notices?.retry();
  return changed;
}
