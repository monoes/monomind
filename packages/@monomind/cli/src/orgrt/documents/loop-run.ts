// orgrt/documents/loop-run.ts
//
// Declared loops enforced (org sections spec 6.15, plan P4.8): a loop's `max_rounds` is a cap on the RETURNS of the
// cycle to the section that published a lineage's first document (loop-rounds.ts: lineageRounds), enforced the way
// P4.7 enforces `max_rework_rounds` but over the loop lineage instead of one document and one consumer.
//
//  - EXHAUSTED: the lineage's returns reached `max_rounds`. Sticky: a further RETURN is refused (store guard on the
//    publish seam, code LOOP_EXHAUSTED, never counted, nothing committed). A publish by the other section, or by the
//    origin without taking an input from the other section and without revising a rejected version, is not a
//    return and is untouched, so the last round can still be reviewed and the loop can end cleanly.
//  - FROZEN: exhausted and some document head of the lineage is not accepted: the root may decide the head (the
//    P4.7 override), and the escalation notice stands until it is acted on.
//  - The escalation NOTICE is derived from the committed log: at the first committed rejection, by a section of the
//    loop, of the head of an exhausted lineage (the round that would have been needed next), the root and the leads
//    of every section of the loop are owed one message (kind `loop-exhausted`, through the P3.8 journal). A last
//    round that is accepted ends the loop cleanly and escalates nothing. The key names the loop, the lineage, the cap
//    and the event, so a replay derives the same key.
//  - Nothing is stored: the loops are read from the live definition at every call, so a reload that raises or lowers
//    `max_rounds` thaws or freezes at once. The `inputs` of a version live only in its body file (not in the derived
//    state), so `storeInputsOf` reads them through the store, once per version (they never change).
import { applyEvent, emptyState, headOf, type DocState } from './state.js';
import { declaredLoops, type InputsOf, lineageRounds, type LoopLineage, type LoopSpec } from './loops.js';
import { KIND_LOOP_EXHAUSTED, type Notice } from './notice.js';
import { COPY_REASON_CAP, capReason, REASON_CAP } from './relay.js';
import type { PublishGuardContext, StoreEvent, StoreGuard } from './store-types.js';

export const LOOP_EXHAUSTED = 'LOOP_EXHAUSTED';

/** One lineage of one declared loop, with what the enforcement derives from it. */
export interface LoopFact extends LoopLineage {
  between: string[];
  types: string[];
  /** Exhausted and not every document head of the lineage accepted yet (the root may decide a head that was rejected). */
  frozen: boolean;
}

/** What the notice engine needs of the loop enforcement. */
export interface LoopEscalation {
  loops(): LoopSpec[];
  inputsOf: InputsOf;
  root: string | undefined;
  /** The roles owed the notice for a lineage: the root and the leads of the loop's sections, once each. */
  recipients(f: LoopFact): string[];
  /** The root may still decide the head of `doc`: its lineage is frozen on a rejection. */
  standing(doc: string): boolean;
}

const REF = /^(.+)@v(\d+)$/;

/** `inputs` of a committed version, read once through the store (read-only: `peek` records nothing). A body that
 *  cannot be read counts as no inputs (the lineage then follows `supersedes` only); a failure is not cached. */
export function storeInputsOf(store: {
  peek(id: string, version?: number): { ok: boolean; inputs?: string[] };
}): InputsOf {
  const cache = new Map<string, readonly string[]>();
  return (ref) => {
    const hit = cache.get(ref);
    if (hit) return hit;
    const m = REF.exec(ref);
    if (!m) return undefined;
    try {
      const r = store.peek(m[1], Number(m[2]));
      if (!r.ok || !Array.isArray(r.inputs)) return undefined;
      cache.set(ref, r.inputs);
      return r.inputs;
    } catch {
      return undefined;
    }
  };
}

/** Every lineage of every loop, each with whether it is frozen. A pure function of the state and the loops. */
export function loopFacts(state: DocState, loops: readonly LoopSpec[], inputsOf?: InputsOf): LoopFact[] {
  return loops.flatMap((loop) =>
    lineageRounds(state, loop, inputsOf).map((l) => ({
      ...l,
      between: [...loop.between],
      types: [...loop.types],
      frozen: l.exhausted && !l.settled,
    })),
  );
}

const loopName = (f: { loop: number; between: string[] }): string => `loops[${f.loop}] (${f.between.join(' and ')})`;

/** The consuming section of the loop the root decides for on `doc` version `version`: the one that rejected it,
 *  when it is the head of a frozen lineage. */
export function loopRootMayDecide(
  state: DocState,
  loops: readonly LoopSpec[],
  inputsOf: InputsOf | undefined,
  doc: string,
  version: number,
): string | undefined {
  const d = state.docs[doc];
  if (!d || headOf(d).version !== version) return undefined;
  const ref = `${doc}@v${version}`;
  const f = loopFacts(state, loops, inputsOf).find((x) => x.frozen && x.versions.includes(ref));
  return f?.between.find((c) => headOf(d).decisions[c]?.decision === 'reject');
}

export interface LoopGuardOptions {
  state(): DocState;
  loops(): LoopSpec[];
  inputsOf: InputsOf;
  root: string | undefined;
}

/** Is this publish a return of the cycle into lineage `f`? (the rule of lineageRounds, applied to a publish not yet committed) */
function returnsInto(state: DocState, f: LoopFact, ctx: PublishGuardContext): boolean {
  if (f.origin !== ctx.section) return false;
  const members = new Set(f.versions);
  const sectionOf = (ref: string): string | undefined => state.docs[REF.exec(ref)?.[1] ?? '']?.section;
  if ((ctx.inputs ?? []).some((r) => members.has(r) && sectionOf(r) !== ctx.section)) return true;
  if (ctx.doc === undefined || !members.has(`${ctx.doc}@v${ctx.version - 1}`)) return false;
  const prior = state.docs[ctx.doc]?.versions[ctx.version - 2];
  return f.between.some((c) => prior?.decisions[c]?.decision === 'reject');
}

/** The refusal of a return beyond `max_rounds`. Runs on the publish seam after the store's own checks and commits nothing. */
export function loopGuard(o: LoopGuardOptions): StoreGuard {
  return {
    publish(ctx) {
      const loops = o.loops().filter((l) => l.types.includes(ctx.type) && l.between.includes(ctx.section));
      if (loops.length === 0) return undefined;
      const state = o.state();
      const f = loopFacts(state, loops, o.inputsOf).find((x) => x.exhausted && returnsInto(state, x, ctx));
      if (!f) return undefined;
      const root = o.root ?? 'the root';
      return {
        code: LOOP_EXHAUSTED,
        message: `This publish would be round ${f.rounds + 1} of ${loopName(f)}, and the loop is spent: its ${f.max_rounds} rounds (loops[${f.loop}].max_rounds) are used, so no further return of the cycle to ${f.origin} is accepted and ${root} decides it (accept the last version, raise max_rounds and reload, or leave it closed). Wait for ${root} or your section lead; do not publish it again.`,
      };
    },
  };
}

function rootText(f: LoopFact, by: string, consumer: string, ref: string, reason: string): { subject: string; body: string } {
  return {
    subject: `loop exhausted: loops[${f.loop}] (${f.between.join(', ')})`,
    body: [
      `The loop ${loopName(f)}, document types ${f.types.join(', ')}, is spent: the lineage that started at ${f.first} has come back to ${f.origin} ${f.rounds} times, which is max_rounds ${f.max_rounds} (loops[${f.loop}].max_rounds).`,
      `Last rejection: ${ref}, by ${by} for ${consumer}: ${capReason(reason, REASON_CAP)}`,
      `The loop is frozen: ${f.origin} cannot publish another round (a revision of a version that ${consumer} rejected, or a document built on one from another section of the loop, is refused).`,
      `You decide. Options: (1) raise the cap: set loops[${f.loop}].max_rounds higher in the org definition and reload it, and ${f.origin} may go another round; (2) decide the document yourself: org_doc_decide on ${ref.replace('@v', ' version ')} with decision "accept" (it replaces ${consumer}'s rejection and ends the loop); (3) reassign the work to another role or section; (4) close the loop: leave it frozen (org_doc_decide with decision "reject" confirms the rejection).`,
    ].join(' '),
  };
}

function leadText(f: LoopFact, by: string, consumer: string, ref: string, reason: string): { subject: string; body: string } {
  return {
    subject: `loop exhausted: loops[${f.loop}] (${f.between.join(', ')}) (copy)`,
    body: `The loop ${loopName(f)} is spent: ${f.rounds} returns, its max_rounds of ${f.max_rounds}. Last rejection (${ref}, ${by} for ${consumer}): ${capReason(reason, COPY_REASON_CAP)} The loop is frozen and the root decides; do not publish another round.`,
  };
}

/**
 * The loop exhaustion notices the committed log obliges under the current loops, in order: at the first committed
 * rejection of the head of an exhausted lineage, one notice per recipient. Replays the log, so it is deterministic.
 */
export function deriveLoopNotices(events: readonly StoreEvent[], esc: LoopEscalation): Notice[] {
  const loops = esc.loops();
  if (loops.length === 0) return [];
  const state = emptyState();
  const out: Notice[] = [];
  const told = new Set<string>();
  for (const e of events) {
    try {
      applyEvent(state, e);
    } catch {
      break; // a corrupt log stops the store; nothing more can be derived
    }
    if (e.type !== 'decided' || e.decision !== 'reject' || e.override) continue;
    const d = state.docs[e.doc];
    if (!d || headOf(d).version !== e.version) continue;
    const ref = `${e.doc}@v${e.version}`;
    const mine = loops.filter((l) => l.types.includes(d.type) && l.between.includes(e.consumer));
    for (const f of loopFacts(state, mine, esc.inputsOf)) {
      const id = `${f.loop}|${f.first}|${f.max_rounds}`;
      if (!f.exhausted || !f.versions.includes(ref) || told.has(id)) continue;
      told.add(id);
      const reason = e.reason ?? '';
      const root = rootText(f, e.by, e.consumer, ref, reason);
      const lead = leadText(f, e.by, e.consumer, ref, reason);
      for (const to of esc.recipients(f))
        out.push({
          key: `l:${id}@${e.seq}:${to}`,
          kind: KIND_LOOP_EXHAUSTED,
          ...(to === esc.root ? {} : { audience: 'lead' as const }),
          to,
          seq: e.seq,
          doc: e.doc,
          version: e.version,
          ...(to === esc.root ? root : lead),
        });
    }
  }
  return out;
}

/** What the loop enforcement of one run is built from. The definition is read live at every call. */
export interface LoopRunOptions {
  def: { sections?: unknown; documents?: unknown; loops?: unknown };
  store: {
    readonly state: DocState;
    peek(id: string, version?: number): { ok: boolean; inputs?: string[] };
  };
  root: string | undefined;
  leadOf(section: string): string | undefined;
}

/** The loop enforcement of one run: the guard, the escalation, the root's decide rule and the report facts. */
export class LoopRun {
  private readonly inputsOf: InputsOf;

  constructor(private readonly o: LoopRunOptions) {
    this.inputsOf = storeInputsOf(o.store);
  }

  private loops = (): LoopSpec[] => declaredLoops(this.o.def);

  guard(): StoreGuard {
    return loopGuard({ state: () => this.o.store.state, loops: this.loops, inputsOf: this.inputsOf, root: this.o.root });
  }

  escalation(): LoopEscalation {
    return {
      loops: this.loops,
      inputsOf: this.inputsOf,
      root: this.o.root,
      recipients: (f) => [...new Set([this.o.root, ...f.between.map((s) => this.o.leadOf(s))].filter((r): r is string => !!r))],
      standing: (doc) => {
        const d = this.o.store.state.docs[doc];
        return !!d && this.mayDecide(doc, headOf(d).version) !== undefined;
      },
    };
  }

  mayDecide(doc: string, version: number): string | undefined {
    return loopRootMayDecide(this.o.store.state, this.loops(), this.inputsOf, doc, version);
  }

  /** The lineages of the declared loops and whether each is spent or frozen. */
  report(): LoopFact[] {
    return loopFacts(this.o.store.state, this.loops(), this.inputsOf);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const sameList = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Copy each loop's `max_rounds` from the proposed definition into the running one, for the entries whose `between`
 *  and `types` are unchanged (the structure of a loop is not reloadable here); returns the `changed` entries. */
export function syncLoopRounds(liveDef: object, nextDef: object): string[] {
  const live = liveDef as { loops?: unknown };
  const next = nextDef as { loops?: unknown };
  if (!Array.isArray(live.loops) || !Array.isArray(next.loops)) return [];
  const changed: string[] = [];
  const liveLoops = live.loops as unknown[];
  next.loops.forEach((n, i) => {
    const target = liveLoops[i];
    if (!isObject(target) || !isObject(n) || target.max_rounds === n.max_rounds) return;
    if (!sameList(target.between, n.between) || !sameList(target.types, n.types)) return;
    target.max_rounds = n.max_rounds;
    changed.push(`loops[${i}].max_rounds`);
  });
  return changed;
}

/** A reload: carry the changed `max_rounds` into the running definition and give the notice engine a pass (a
 *  lowered cap can owe a notice). Returns the `changed` entries. */
export function reloadLoopRounds(
  live: object,
  next: object,
  docs: { notices?: { retry(): Promise<void> } } | undefined,
): string[] {
  const changed = syncLoopRounds(live, next);
  if (docs && changed.length > 0) void docs.notices?.retry();
  return changed;
}
