// packages/@monomind/cli/src/orgrt/documents/loops.ts
/**
 * Org sections spec 6.15 and plan P4.3 (pure; P4.8 wires it: definition.ts takes `loopFindings`, loop-run.ts and runtime.ts take `declaredLoops` and the round rules).
 *
 * The section graph, the cycle check and the validation of the `loops` key:
 *  - `sectionGraph(def)`: one edge per (producing section, consuming section, type), from `publishes` and `consumes`.
 *  - `cycles(def)`: the strongly connected components with a cycle in them (Tarjan). A component is the unit a loop
 *    must cover, so nested and overlapping cycles inside one component are one finding, not several.
 *  - `loopProblems(def)`: typed problems (code, severity, path, message, remedy). `loopFindings(def)` is the same
 *    list as the `{errors, warnings}` strings the definition check uses. `declaredLoops(def)` is the well-formed
 *    entries as `LoopSpec`.
 * The round rule and the rework cap live in loop-rounds.ts (re-exported here). Nothing reads the clock or the disk.
 */
import type { Findings } from './definition-util.js';
import { isObject } from './definition-util.js';

export type { InputsOf, LoopLineage, ReworkThread } from './loop-rounds.js';
export { capsFromDef, lineageRounds, reworkStatus, reworkThreads } from './loop-rounds.js';

/** The part of an org definition this file reads; an `OrgDef` fits it. */
export interface LoopsInput {
  sections?: unknown;
  documents?: unknown;
  loops?: unknown;
}

/** Codes are never renamed or reused, only added. */
export const LOOP_CODES = [
  'LOOPS_NOT_LIST',
  'LOOP_NOT_OBJECT',
  'LOOP_UNKNOWN_FIELD',
  'LOOP_BETWEEN_INVALID',
  'LOOP_SECTION_UNKNOWN',
  'LOOP_TYPES_INVALID',
  'LOOP_TYPE_UNKNOWN',
  'LOOP_TYPE_OUTSIDE',
  'LOOP_ROUNDS_INVALID',
  'LOOP_OVERLAP',
  'LOOP_NO_CYCLE',
  'LOOP_EXTRA_SECTION',
  'CYCLE_UNDECLARED',
  'CYCLE_SELF_EDGE',
] as const;
export type LoopCode = (typeof LOOP_CODES)[number];

export interface LoopProblem {
  code: LoopCode;
  severity: 'error' | 'warning';
  path: string;
  message: string;
  remedy: string;
}

/** One declared loop: the sections that trade documents, the types that travel, the round cap. Escalation is always the root. */
export interface LoopSpec {
  /** Position in the `loops` list. */
  index: number;
  between: string[];
  types: string[];
  max_rounds: number;
}

export interface SectionEdge {
  from: string;
  to: string;
  type: string;
}

export interface SectionGraph {
  /** Every section, sorted. */
  sections: string[];
  /** Sorted by (from, to, type); a self-edge (from === to) is kept so the cycle check can name it. */
  edges: SectionEdge[];
}

export interface Cycle {
  /** The sections of the component, sorted. A self-edge is a component of one. */
  sections: string[];
  /** The edges with both ends inside the component, sorted. */
  edges: SectionEdge[];
  selfEdge: boolean;
}

export interface ClassifiedCycle {
  cycle: Cycle;
  /** The declared loops that cover it (their `between` names every section of it). Empty: undeclared. */
  loops: number[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

/** producer section -> consumer section, per document type. Reads `sections.<s>.publishes` and `.consumes`. */
export function sectionGraph(def: LoopsInput): SectionGraph {
  const secs = isObject(def.sections) ? def.sections : {};
  const names = Object.keys(secs).sort(byText);
  const producers = new Map<string, string[]>();
  const consumers = new Map<string, string[]>();
  for (const s of names) {
    const sec = secs[s];
    if (!isObject(sec)) continue;
    for (const t of strList(sec.publishes)) producers.set(t, [...(producers.get(t) ?? []), s]);
    for (const t of strList(sec.consumes)) consumers.set(t, [...(consumers.get(t) ?? []), s]);
  }
  const edges: SectionEdge[] = [];
  for (const [type, ps] of producers)
    for (const from of ps)
      for (const to of consumers.get(type) ?? []) edges.push({ from, to, type });
  edges.sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to) || byText(a.type, b.type));
  return { sections: names, edges };
}

/** Strongly connected components of two or more sections, and sections with an edge to themselves. */
export function cycles(def: LoopsInput): Cycle[] {
  const g = sectionGraph(def);
  const next = new Map<string, string[]>(g.sections.map((s) => [s, []]));
  for (const e of g.edges) if (!next.get(e.from)?.includes(e.to)) next.get(e.from)?.push(e.to);
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: Cycle[] = [];
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
    }
    if (low.get(v) !== index.get(v)) return;
    const comp: string[] = [];
    for (let w = stack.pop() as string; ; w = stack.pop() as string) {
      onStack.delete(w);
      comp.push(w);
      if (w === v) break;
    }
    const set = new Set(comp);
    const edges = g.edges.filter((e) => set.has(e.from) && set.has(e.to));
    const selfEdge = comp.length === 1 && edges.some((e) => e.from === e.to);
    if (comp.length > 1 || selfEdge) out.push({ sections: comp.sort(byText), edges, selfEdge });
  };
  for (const s of g.sections) if (!index.has(s)) visit(s);
  return out.sort((a, b) => byText(a.sections[0], b.sections[0]));
}

interface ParsedLoop {
  index: number;
  /** Set when the shape is right and every section exists: usable for covering and overlap. */
  between?: string[];
  types?: string[];
  max_rounds?: number;
  failed: boolean;
}

const FIELDS = ['between', 'types', 'max_rounds'];
const quote = (xs: string[]): string => xs.map((x) => `"${x}"`).join(', ');
const shown = (v: unknown): string => {
  const s = JSON.stringify(v);
  return s === undefined ? 'nothing' : s.length > 60 ? `${s.slice(0, 57)}...` : s;
};

function parseLoops(def: LoopsInput, g: SectionGraph, out: LoopProblem[]): ParsedLoop[] {
  if (def.loops === undefined) return [];
  const add = (
    code: LoopCode,
    severity: 'error' | 'warning',
    path: string,
    message: string,
    remedy: string,
  ) => out.push({ code, severity, path, message, remedy });
  if (!Array.isArray(def.loops)) {
    add(
      'LOOPS_NOT_LIST',
      'error',
      'loops',
      `must be a list of {"between", "types", "max_rounds"} objects — got ${shown(def.loops)}`,
      'write loops as a list, for example [{"between": ["development", "qa"], "types": ["build", "test-report"], "max_rounds": 4}]',
    );
    return [];
  }
  const known = new Set(g.sections);
  const declaredTypes = new Set<string>([
    ...(isObject(def.documents) ? Object.keys(def.documents) : []),
    ...g.edges.map((e) => e.type),
  ]);
  return def.loops.map((raw, index): ParsedLoop => {
    const at = `loops[${index}]`;
    const before = out.length;
    if (!isObject(raw)) {
      add(
        'LOOP_NOT_OBJECT',
        'error',
        at,
        `must be an object — got ${shown(raw)}`,
        'write {"between": [...], "types": [...], "max_rounds": N}',
      );
      return { index, failed: true };
    }
    for (const k of Object.keys(raw))
      if (!FIELDS.includes(k))
        add(
          'LOOP_UNKNOWN_FIELD',
          'error',
          `${at}.${k}`,
          `unknown loop field "${k}" — known fields: ${FIELDS.join(', ')}`,
          `remove "${k}" (a loop escalates to the root; there is nothing else to set)`,
        );

    // between: two or more distinct, existing sections.
    let between: string[] | undefined;
    const b = raw.between;
    if (
      !Array.isArray(b) ||
      b.length < 2 ||
      b.some((x) => typeof x !== 'string' || x === '') ||
      new Set(b).size !== b.length
    )
      add(
        'LOOP_BETWEEN_INVALID',
        'error',
        `${at}.between`,
        `must list two or more distinct section names — got ${shown(b)}`,
        'name the sections that hand documents back and forth, for example ["development", "qa"]',
      );
    else {
      const missing = (b as string[]).filter((s) => !known.has(s));
      for (const s of missing)
        add(
          'LOOP_SECTION_UNKNOWN',
          'error',
          `${at}.between`,
          `section "${s}" does not exist (sections are: ${g.sections.join(', ') || 'none'})`,
          `use a section name from sections, or remove "${s}"`,
        );
      if (missing.length === 0) between = [...(b as string[])].sort(byText);
    }

    // types: existing document types that are edges between the loop's own sections.
    let types: string[] | undefined;
    const t = raw.types;
    if (
      !Array.isArray(t) ||
      t.length === 0 ||
      t.some((x) => typeof x !== 'string' || x === '') ||
      new Set(t).size !== t.length
    )
      add(
        'LOOP_TYPES_INVALID',
        'error',
        `${at}.types`,
        `must list one or more distinct document types — got ${shown(t)}`,
        'name the document types that travel around the loop, for example ["build", "test-report"]',
      );
    else {
      types = [...(t as string[])];
      for (const ty of types) {
        if (!declaredTypes.has(ty))
          add(
            'LOOP_TYPE_UNKNOWN',
            'error',
            `${at}.types`,
            `type "${ty}" is not a document type of this org`,
            `declare documents.${ty} and publish it from a section, or remove "${ty}"`,
          );
        else if (
          between &&
          !g.edges.some((e) => e.type === ty && between.includes(e.from) && between.includes(e.to))
        )
          add(
            'LOOP_TYPE_OUTSIDE',
            'error',
            `${at}.types`,
            `type "${ty}" is not handed from one of ${quote(between)} to another of them`,
            `remove "${ty}", or add it to the publishes of one of these sections and the consumes of another`,
          );
      }
    }

    const r = raw.max_rounds;
    const roundsOk = typeof r === 'number' && Number.isInteger(r) && r > 0;
    if (!roundsOk)
      add(
        'LOOP_ROUNDS_INVALID',
        'error',
        `${at}.max_rounds`,
        `must be a positive integer — got ${shown(r)}`,
        'set max_rounds to the number of rounds the loop may run before the root decides, for example 4',
      );
    return {
      index,
      between,
      types,
      max_rounds: roundsOk ? (r as number) : undefined,
      failed: out.length > before,
    };
  });
}

/** Every problem with the `loops` key and the section cycles, errors and warnings, in a fixed order. */
export function loopProblems(def: LoopsInput): LoopProblem[] {
  const out: LoopProblem[] = [];
  const g = sectionGraph(def);
  const parsed = parseLoops(def, g, out);
  const usable = parsed.filter((p) => p.between);

  for (const [i, a] of usable.entries())
    for (const b of usable.slice(i + 1)) {
      const shared = (a.between as string[]).filter((s) => (b.between as string[]).includes(s));
      if (shared.length > 0)
        out.push({
          code: 'LOOP_OVERLAP',
          severity: 'error',
          path: `loops[${b.index}].between`,
          message: `shares ${quote(shared)} with loops[${a.index}] — a section belongs to at most one loop`,
          remedy: `merge the two entries into one, or give each loop its own sections`,
        });
    }

  const covered = new Set<number>();
  for (const c of cycles(def)) {
    const names = quote(c.sections);
    const types = quote([...new Set(c.edges.map((e) => e.type))].sort(byText));
    if (c.selfEdge) {
      out.push({
        code: 'CYCLE_SELF_EDGE',
        severity: 'error',
        path: `sections.${c.sections[0]}`,
        message: `section "${c.sections[0]}" consumes ${types}, which it publishes itself — a section cannot hand a document to itself`,
        remedy: "remove the type from this section's consumes or from its publishes",
      });
      continue;
    }
    const by = usable.filter((p) => c.sections.every((s) => (p.between as string[]).includes(s)));
    for (const p of by) covered.add(p.index);
    if (by.length === 0)
      out.push({
        code: 'CYCLE_UNDECLARED',
        severity: 'error',
        path: c.sections.map((s) => `sections.${s}`).join(', '),
        message: `sections ${names} hand documents around a cycle (types ${types}) and no loop declares it`,
        remedy: `declare it: loops: [{"between": [${names}], "types": [${types}], "max_rounds": N}], or break the cycle by removing one of those types from a consumes or publishes list`,
      });
  }
  for (const p of usable)
    if (!covered.has(p.index))
      out.push({
        code: 'LOOP_NO_CYCLE',
        severity: 'warning',
        path: `loops[${p.index}]`,
        message: `${quote(p.between as string[])} do not form a cycle of document hand-offs, so this loop bounds nothing`,
        remedy:
          'remove the entry, or add the missing consumes or publishes edge that closes the cycle',
      });
    else {
      const inCycle = new Set(
        cycles(def)
          .filter((c) => c.sections.every((s) => (p.between as string[]).includes(s)))
          .flatMap((c) => c.sections),
      );
      const extra = (p.between as string[]).filter((s) => !inCycle.has(s));
      if (extra.length > 0)
        out.push({
          code: 'LOOP_EXTRA_SECTION',
          severity: 'warning',
          path: `loops[${p.index}].between`,
          message: `${quote(extra)} take no part in the cycle this loop covers`,
          remedy: `remove ${quote(extra)} from between`,
        });
    }
  return out;
}

const render = (p: LoopProblem): string => `${p.path}: ${p.message} — ${p.remedy}`;

/** `loopProblems` as the `{errors, warnings}` strings of the definition check (path, message, remedy). */
export function loopFindings(def: LoopsInput, skip: readonly LoopCode[] = []): Findings {
  const f: Findings = { errors: [], warnings: [] };
  for (const p of loopProblems(def).filter((x) => !skip.includes(x.code)))
    (p.severity === 'error' ? f.errors : f.warnings).push(render(p));
  return f;
}

/** The loops whose entry has no error: the ones a runtime may count rounds for. */
export function declaredLoops(def: LoopsInput): LoopSpec[] {
  const g = sectionGraph(def);
  return parseLoops(def, g, [])
    .filter((p) => !p.failed && p.between && p.types && p.max_rounds !== undefined)
    .map((p) => ({
      index: p.index,
      between: p.between as string[],
      types: p.types as string[],
      max_rounds: p.max_rounds as number,
    }));
}

/** Each cycle with the declared loops that cover it: the classification the findings are made from. */
export function classifyCycles(def: LoopsInput): ClassifiedCycle[] {
  const g = sectionGraph(def);
  const usable = parseLoops(def, g, []).filter((p) => p.between);
  return cycles(def).map((cycle) => ({
    cycle,
    loops: cycle.selfEdge
      ? []
      : usable
          .filter((p) => cycle.sections.every((s) => (p.between as string[]).includes(s)))
          .map((p) => p.index),
  }));
}
