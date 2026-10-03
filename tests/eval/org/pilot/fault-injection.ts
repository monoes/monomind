// tests/eval/org/pilot/fault-injection.ts
//
// Harness-seeded faults in published documents (parallel-sweep-3, treatment arm only). The plan picks a fixed
// number of documents by seed and gives each a different class of fault; the injector changes a document's
// content at its first successful publish (store.ts applies it once per document and records it), so the
// version a consumer reads is corrupted while the producer's own files stay correct. Nothing here runs unless
// a trial's manifest sets `fault_injection` and the trial is the treatment arm (prepare.ts, harness.ts).
//
// The faults are made by the harness, so a run measures the consumer's decision path (read, check, accept or
// reject), not the natural error rate of the producers.
import { createHash } from 'node:crypto';
import type { PublishInjector } from './store.js';

export const FAULT_CLASSES = [
  'wrong-value-q05',
  'wrong-value-q07',
  'files-order',
  'duplicate-sheet',
] as const;
export type FaultClass = (typeof FAULT_CLASSES)[number];

export interface FaultSpec {
  doc: string;
  class: FaultClass;
  /** Added to the answer's value by the two wrong-value classes. */
  delta: number;
}

export interface FaultPlan {
  seed: number;
  faults: FaultSpec[];
}

/** mulberry32: a small seeded generator, so a plan is a pure function of its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One document per class, chosen and ordered by the seed; the same seed and documents give the same plan. */
export function planFaults(
  seed: number,
  docs: string[],
  classes: readonly FaultClass[] = FAULT_CLASSES,
): FaultPlan {
  if (classes.length > docs.length)
    throw new Error(
      `${classes.length} faults need at least that many documents, got ${docs.length}`,
    );
  const next = rng(seed);
  const order = [...docs];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    seed,
    faults: classes.map((c, i) => ({
      doc: order[i],
      class: c,
      delta: 3 + Math.floor(next() * 17),
    })),
  };
}

type Answer = { q: string; value: number; files: string[] };
type Sheet = { module: string; answers: Answer[] };
type Doc = { worker?: string; sheets: Sheet[] };

const sha = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);
/** The q07 sum of the synthesis names every third module from m2 (fixtures/parallel-sweep/synthesis.mjs). */
const inQ07Subset = (module: string) => (Number(module.slice(1)) - 1) % 3 === 1;

interface Change {
  content: Doc;
  module: string;
  qs: string[];
  changed: string;
}

function mutate(c: FaultClass, delta: number, doc: Doc): Change | undefined {
  const out = structuredClone(doc);
  if (!Array.isArray(out.sheets) || out.sheets.length === 0) return undefined;
  const byQ = (s: Sheet, q: string) => s.answers.find((a) => a.q === q);
  if (c === 'wrong-value-q05' || c === 'wrong-value-q07') {
    const q = c === 'wrong-value-q05' ? 'q05' : 'q07';
    const sheet = out.sheets.find((s) => q === 'q05' || inQ07Subset(s.module));
    const a = sheet && byQ(sheet, q);
    if (!sheet || !a) return undefined;
    const from = a.value;
    a.value = from + delta;
    return {
      content: out,
      module: sheet.module,
      qs: [q],
      changed: `${sheet.module}.${q} value ${from} -> ${a.value}`,
    };
  }
  if (c === 'files-order') {
    const sheet = out.sheets[0];
    const qs = ['q01', 'q02'].filter((q) => byQ(sheet, q));
    for (const q of qs) (byQ(sheet, q) as Answer).files.reverse();
    return {
      content: out,
      module: sheet.module,
      qs,
      changed: `${sheet.module} files lists of ${qs.join(', ')} reversed`,
    };
  }
  // duplicate-sheet: the second sheet carries the first sheet's answers (a copy across modules)
  if (out.sheets.length < 2) return undefined;
  out.sheets[1].answers = structuredClone(out.sheets[0].answers);
  return {
    content: out,
    module: out.sheets[1].module,
    qs: out.sheets[1].answers.map((a) => a.q),
    changed: `${out.sheets[1].module} answers replaced by a copy of ${out.sheets[0].module}'s`,
  };
}

/** The store hook for a plan: it changes the first successful publish of each planned document, once. */
export function faultInjector(plan: FaultPlan): PublishInjector {
  const byDoc = new Map(plan.faults.map((f) => [f.doc, f]));
  return {
    apply(doc, content) {
      const f = byDoc.get(doc);
      if (!f) return undefined;
      const r = mutate(f.class, f.delta, content as Doc);
      if (!r || sha(r.content) === sha(content)) return undefined;
      return {
        content: r.content,
        record: {
          class: f.class,
          module: r.module,
          qs: r.qs,
          changed: r.changed,
          from_sha: sha(content),
          to_sha: sha(r.content),
        },
      };
    },
  };
}
