// packages/@monomind/cli/src/orgrt/documents/loop-rounds.ts
/**
 * Org sections spec 6.5 and 6.15, plan P4.3 and open item 27 (pure, inert; re-exported by loops.ts).
 * The round rules over the derived document state (state.ts); status is derived, never stored (R16).
 *
 * REWORK ROUND (per document and consuming section): the number of versions of the document that the consumer
 * rejected. One version counts once however many times the decision is replayed (the reducer refuses a second
 * decision by the same consumer, and this file counts versions, not events). The thread is EXHAUSTED when that
 * number reaches the consuming section's `max_rework_rounds`; an unset cap means no cap.
 *
 * LOOP ROUND (per lineage of a declared loop): one return of the cycle to the section that published the lineage's
 * first document. A lineage is the set of loop-type versions joined by `supersedes` (a document's own chain) and by
 * `inputs` references. A version is a RETURN when the lineage already existed, its document belongs to the lineage's
 * origin section, and either (a) it takes an input published by another section of the loop, or (b) it supersedes a
 * version that a section of the loop rejected. Each return counts once. The lineage is EXHAUSTED when its rounds
 * reach `max_rounds`.
 * Versions are walked in commit order. When a version joins lineages that were separate, the merged lineage keeps
 * the one with more rounds (ties: the earlier first version) and its origin, so counts never fall.
 *
 * The store keeps `inputs` in the version body file, not in the derived state, so the caller passes `inputsOf`.
 * Without it only `supersedes` links are seen.
 */

import type { LoopSpec } from './loops.js';
import type { DocRecord, DocState, VersionRecord } from './state.js';
import { headOf, versionStatus } from './state.js';

/** `id@vN` -> the `inputs` references that version was published with. */
export type InputsOf = (ref: string) => readonly string[] | undefined;

export interface LoopLineage {
  /** `LoopSpec.index`. */
  loop: number;
  /** The section that published the first version. */
  origin: string;
  /** Ref of the lineage's first version (lowest commit sequence). */
  first: string;
  /** Every version ref in it, in commit order. */
  versions: string[];
  rounds: number;
  max_rounds: number;
  /** `rounds >= max_rounds`: the root decides; P4.7 freezes `supersedes` on the lineage. Sticky once true. */
  exhausted: boolean;
  /** Commit sequence of the return that reached the cap. */
  exhausted_seq?: number;
  /** Every document head in the lineage is accepted: the loop ended cleanly. */
  settled: boolean;
  /** Who is told when exhausted: the root, with a copy to the leads of these sections. */
  escalate: { to: 'root'; copy_leads_of: string[] };
}

export interface ReworkThread {
  doc: string;
  type: string;
  /** The section that publishes the document. */
  producer_section: string;
  /** The consuming section that rejected, and whose cap applies. */
  consumer: string;
  /** Versions of the document the consumer rejected. */
  rounds: number;
  cap: number;
  exhausted: boolean;
  /** Commit sequence of the rejection that reached the cap. */
  exhausted_seq?: number;
  /** Version numbers rejected, ascending. */
  rejected_versions: number[];
}

const refOf = (d: DocRecord, v: VersionRecord): string => `${d.id}@v${v.version}`;

interface Node {
  ref: string;
  doc: DocRecord;
  v: VersionRecord;
}

interface Group {
  origin: string;
  first: Node;
  rounds: number;
  exhaustedSeq?: number;
  members: Node[];
}

/** The lineages of one declared loop, ordered by their first version. Empty when no loop-type document exists. */
export function lineageRounds(state: DocState, loop: LoopSpec, inputsOf?: InputsOf): LoopLineage[] {
  const nodes: Node[] = [];
  for (const d of Object.values(state.docs))
    if (loop.types.includes(d.type) && loop.between.includes(d.section))
      for (const v of d.versions) nodes.push({ ref: refOf(d, v), doc: d, v });
  nodes.sort((a, b) => a.v.seq - b.v.seq);

  const byRef = new Map(nodes.map((n) => [n.ref, n]));
  const groupOf = new Map<string, Group>();
  const rejectedByLoop = (p: Node, before: number): boolean =>
    Object.entries(p.v.decisions).some(
      ([c, x]) => x.decision === 'reject' && loop.between.includes(c) && x.seq < before,
    );

  for (const n of nodes) {
    const pred =
      n.v.supersedes !== undefined ? byRef.get(`${n.doc.id}@v${n.v.supersedes}`) : undefined;
    const fed = (inputsOf?.(n.ref) ?? [])
      .map((r) => byRef.get(r))
      .filter((p): p is Node => p !== undefined && p.v.seq < n.v.seq);
    const parents = [...(pred ? [pred] : []), ...fed];
    const joined = [...new Set(parents.map((p) => groupOf.get(p.ref) as Group))];

    let g: Group;
    if (joined.length === 0) g = { origin: n.doc.section, first: n, rounds: 0, members: [] };
    else {
      g = joined.reduce((best, x) =>
        x.rounds > best.rounds || (x.rounds === best.rounds && x.first.v.seq < best.first.v.seq)
          ? x
          : best,
      );
      for (const o of joined)
        if (o !== g) {
          g.members.push(...o.members);
          for (const m of o.members) groupOf.set(m.ref, g);
          if (o.exhaustedSeq !== undefined)
            g.exhaustedSeq = Math.min(g.exhaustedSeq ?? o.exhaustedSeq, o.exhaustedSeq);
        }
      const feedback = fed.some((p) => p.doc.section !== n.doc.section);
      const reworked = pred !== undefined && rejectedByLoop(pred, n.v.seq);
      if (n.doc.section === g.origin && (feedback || reworked)) {
        g.rounds += 1;
        if (g.rounds >= loop.max_rounds && g.exhaustedSeq === undefined) g.exhaustedSeq = n.v.seq;
      }
    }
    g.members.push(n);
    groupOf.set(n.ref, g);
  }

  const groups = [...new Set(groupOf.values())].sort((a, b) => a.first.v.seq - b.first.v.seq);
  return groups.map((g) => {
    const docs = [...new Set(g.members.map((m) => m.doc))];
    return {
      loop: loop.index,
      origin: g.origin,
      first: g.first.ref,
      versions: g.members.sort((a, b) => a.v.seq - b.v.seq).map((m) => m.ref),
      rounds: g.rounds,
      max_rounds: loop.max_rounds,
      exhausted: g.rounds >= loop.max_rounds,
      ...(g.exhaustedSeq !== undefined ? { exhausted_seq: g.exhaustedSeq } : {}),
      settled: docs.every((d) => versionStatus(d, headOf(d)) === 'accepted'),
      escalate: { to: 'root' as const, copy_leads_of: [...loop.between] },
    };
  });
}

/** The positive-integer `max_rework_rounds` of every section that sets one, keyed by section. Unset: no entry, no cap. */
export function capsFromDef(def: { sections?: unknown }): Record<string, number> {
  const out: Record<string, number> = {};
  const secs =
    typeof def.sections === 'object' && def.sections !== null
      ? (def.sections as Record<string, unknown>)
      : {};
  for (const [name, sec] of Object.entries(secs)) {
    const n =
      typeof sec === 'object' && sec !== null
        ? (sec as Record<string, unknown>).max_rework_rounds
        : undefined;
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[name] = n;
  }
  return out;
}

/**
 * Every (document, consuming section) thread with at least one rejection whose consumer has a cap
 * (`caps[consumer]`; a section with no entry has no cap and no thread), ordered by document id then consumer.
 */
export function reworkThreads(
  state: DocState,
  caps: Readonly<Record<string, number | undefined>>,
): ReworkThread[] {
  const out: ReworkThread[] = [];
  for (const d of Object.values(state.docs).sort((a, b) => (a.id < b.id ? -1 : 1)))
    for (const consumer of [...new Set(d.versions.flatMap((v) => v.consumers))].sort()) {
      const cap = caps[consumer];
      if (cap === undefined) continue;
      const rejected = d.versions.filter((v) => v.decisions[consumer]?.decision === 'reject');
      if (rejected.length === 0) continue;
      const seqs = rejected.map((v) => v.decisions[consumer].seq).sort((a, b) => a - b);
      out.push({
        doc: d.id,
        type: d.type,
        producer_section: d.section,
        consumer,
        rounds: rejected.length,
        cap,
        exhausted: rejected.length >= cap,
        ...(rejected.length >= cap ? { exhausted_seq: seqs[cap - 1] } : {}),
        rejected_versions: rejected.map((v) => v.version),
      });
    }
  return out;
}

/** The exhausted threads, in the order they were exhausted (by commit sequence). */
export function reworkStatus(
  state: DocState,
  caps: Readonly<Record<string, number | undefined>>,
): ReworkThread[] {
  return reworkThreads(state, caps)
    .filter((t) => t.exhausted)
    .sort((a, b) => (a.exhausted_seq as number) - (b.exhausted_seq as number));
}
