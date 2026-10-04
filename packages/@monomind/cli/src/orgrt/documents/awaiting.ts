// orgrt/documents/awaiting.ts
//
// Is a role "waiting for documents" (org sections plan P3.16c, parity-trial finding 4)? Lead-watch reports a
// started role that holds open work and has gone quiet ("silent with open work"). A consumer decision maker
// that was briefed "wait for the documents" and ended its turn is quiet on purpose: the runtime wakes it with a
// publication notice (R24). This file decides, from the documents runtime, when a role's quiet is that wait, so
// lead-watch can skip it. Only lead-watch's silent case asks; a role that never started is still reported.
//
// The rule. A role is awaiting documents when it decides for at least one document type AND it has no work in
// hand AND something is still to come for it:
//   - work in hand: the head of a document of a type it decides is pending, it has read that version and has not
//     decided it. A consumer that read a version and then does nothing is silent in earnest.
//   - still to come: a type it decides has no document yet (it has no notice yet), or a head it has not read
//     (its notice is pending or delivered; the unread-watch of P3.13 flags that one, not lead-watch), or a head
//     it rejected (it waits for the producer's revision and the notice that announces it).
// A role that decides nothing, or whose every needed type exists and is settled, is never awaiting.

import { deciders } from './notice.js';
import type { DocumentsRuntime } from './runtime.js';

export interface AwaitHead {
  doc: string;
  type: string;
  version: number;
  status: 'pending' | 'accepted' | 'rejected' | 'superseded';
  /** Roles that decided this version (the `by` of its decisions). */
  decided: string[];
  /** Roles that read this version. */
  read: string[];
}

export interface AwaitFacts {
  types: { type: string; deciders: string[] }[];
  /** The head version of every document that exists. */
  heads: AwaitHead[];
}

export function awaitingDocuments(role: string, f: AwaitFacts): boolean {
  const mine = f.types.filter((t) => t.deciders.includes(role)).map((t) => t.type);
  if (mine.length === 0) return false;
  const heads = f.heads.filter((h) => mine.includes(h.type));
  let toCome = mine.some((t) => !heads.some((h) => h.type === t));
  for (const h of heads) {
    if (h.status === 'rejected') toCome = true; // waiting for the producer's revision
    if (h.status !== 'pending' || h.decided.includes(role)) continue;
    if (h.read.includes(role)) return false; // read and not decided: work in hand
    toCome = true; // told, not yet read
  }
  return toCome;
}

/** The facts of one run's documents, from the store and the notice engine's record of who read what. */
export function awaitFacts(docs: DocumentsRuntime): AwaitFacts {
  const readers = new Map<string, string[]>(); // `doc@version` -> roles that read it
  for (const f of docs.notices?.facts() ?? [])
    readers.set(`${f.doc}@${f.version}`, Object.keys(f.first_read_at));
  return {
    types: docs.bindings.map((b) => ({ type: b.contract.type, deciders: deciders(b) })),
    heads: docs.store.list().flatMap((d) => {
      const seen = docs.store.peek(d.id, d.head.version);
      return seen.ok
        ? [
            {
              doc: d.id,
              type: d.type,
              version: d.head.version,
              status: d.head.status,
              decided: Object.values(seen.decisions).map((x) => x.by),
              read: readers.get(`${d.id}@${d.head.version}`) ?? [],
            },
          ]
        : [];
    }),
  };
}
