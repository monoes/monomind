// packages/@monomind/cli/__tests__/orgrt/documents/loops.test.ts
// P4.3 (spec 6.15, plan 13.2): the section graph, the cycle check, the validation of the `loops` key.
// Pure functions over a literal definition; nothing here reads the clock, the disk or the network.
import { describe, expect, it } from 'vitest';
import {
  LOOP_CODES,
  classifyCycles,
  cycles,
  declaredLoops,
  loopFindings,
  loopProblems,
  sectionGraph,
} from '../../../src/orgrt/documents/loops.js';
import type { LoopCode } from '../../../src/orgrt/documents/loops.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';

type Edges = Record<string, { consumes?: string[]; publishes?: string[] }>;

/** A definition fragment: the sections as given, a `documents` entry for every type they name. */
function def(sections: Edges, loops?: unknown): Record<string, unknown> {
  const types = new Set(Object.values(sections).flatMap((s) => [...(s.consumes ?? []), ...(s.publishes ?? [])]));
  const full = Object.fromEntries(Object.entries(sections).map(([n, s]) => [n, { members: [n], ...s }]));
  return { sections: full, documents: Object.fromEntries([...types].map((t) => [t, {}])), ...(loops !== undefined ? { loops } : {}) };
}

const codes = (d: Record<string, unknown>): LoopCode[] => loopProblems(d).map((p) => p.code);

// development -> qa (build), qa -> development (report)
const PAIR: Edges = {
  development: { consumes: ['report'], publishes: ['build'] },
  qa: { consumes: ['build'], publishes: ['report'] },
};
const PAIR_LOOP = { between: ['development', 'qa'], types: ['build', 'report'], max_rounds: 4 };
// a -> b -> c -> a
const RING: Edges = {
  a: { consumes: ['zc'], publishes: ['xa'] },
  b: { consumes: ['xa'], publishes: ['yb'] },
  c: { consumes: ['yb'], publishes: ['zc'] },
};

describe('sectionGraph: one edge per producing section, consuming section and type', () => {
  it('has no edge when nothing is consumed', () => {
    const g = sectionGraph(def({ a: { publishes: ['x'] }, b: {} }));
    expect(g.sections).toEqual(['a', 'b']);
    expect(g.edges).toEqual([]);
  });

  it('draws producer to consumer, sorted', () => {
    expect(sectionGraph(def(PAIR)).edges).toEqual([
      { from: 'development', to: 'qa', type: 'build' },
      { from: 'qa', to: 'development', type: 'report' },
    ]);
  });

  it('several consumers of one type each get an edge; several producers each get one (the definition check refuses that elsewhere)', () => {
    const g = sectionGraph(def({ a: { publishes: ['x'] }, b: { publishes: ['x'] }, c: { consumes: ['x'] }, d: { consumes: ['x'] } }));
    expect(g.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['a>c', 'a>d', 'b>c', 'b>d']);
  });

  it('ignores malformed sections and malformed edge lists instead of throwing', () => {
    const g = sectionGraph({ sections: { a: 5, b: { publishes: 'x', consumes: [1, '', 'x'] }, c: null } });
    expect(g.edges).toEqual([]);
    expect(sectionGraph({}).sections).toEqual([]);
    expect(sectionGraph({ sections: [] }).sections).toEqual([]);
  });
});

describe('cycles: strongly connected components', () => {
  it('an acyclic chain has none', () => {
    expect(cycles(def({ a: { publishes: ['x'] }, b: { consumes: ['x'], publishes: ['y'] }, c: { consumes: ['y'] } }))).toEqual([]);
  });

  it('a diamond (two paths, no way back) has none', () => {
    const d = def({
      a: { publishes: ['x', 'y'] },
      b: { consumes: ['x'], publishes: ['p'] },
      c: { consumes: ['y'], publishes: ['q'] },
      d: { consumes: ['p', 'q'] },
    });
    expect(cycles(d)).toEqual([]);
  });

  it('a two-section cycle is one component with both edges', () => {
    const [c] = cycles(def(PAIR));
    expect(c.sections).toEqual(['development', 'qa']);
    expect(c.edges.map((e) => e.type)).toEqual(['build', 'report']);
    expect(c.selfEdge).toBe(false);
  });

  it('a three-section cycle is one component', () => {
    expect(cycles(def(RING)).map((c) => c.sections)).toEqual([['a', 'b', 'c']]);
  });

  it('nested cycles (a-b and a-b-c sharing a) are ONE component, not two findings', () => {
    const d = def({
      a: { consumes: ['back-b', 'back-c'], publishes: ['to-b'] },
      b: { consumes: ['to-b'], publishes: ['back-b', 'to-c'] },
      c: { consumes: ['to-c'], publishes: ['back-c'] },
    });
    expect(cycles(d).map((c) => c.sections)).toEqual([['a', 'b', 'c']]);
  });

  it('two disjoint cycles are two components, a tail section hanging off one is not part of it', () => {
    const d = def({
      a: { consumes: ['y'], publishes: ['x'] },
      b: { consumes: ['x'], publishes: ['y', 'tail'] },
      t: { consumes: ['tail'] },
      c: { consumes: ['q'], publishes: ['p'] },
      d: { consumes: ['p'], publishes: ['q'] },
    });
    expect(cycles(d).map((c) => c.sections)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('a section that consumes what it publishes is a self-edge component of one', () => {
    const [c] = cycles(def({ a: { consumes: ['x'], publishes: ['x'] } }));
    expect(c).toMatchObject({ sections: ['a'], selfEdge: true });
  });

  it('a lone section with no self-edge is no cycle', () => {
    expect(cycles(def({ a: { publishes: ['x'] } }))).toEqual([]);
  });

  it('a deep chain does not overflow the stack', () => {
    const sections: Edges = {};
    for (let i = 0; i < 400; i += 1) sections[`s${String(i).padStart(3, '0')}`] = { consumes: i === 0 ? [] : [`t${i - 1}`], publishes: [`t${i}`] };
    expect(cycles(def(sections))).toEqual([]);
  });
});

describe('loopFindings: an undeclared cycle is an error, a declared one passes', () => {
  it('no cycle and no loops: no findings', () => {
    expect(loopFindings(def({ a: { publishes: ['x'] }, b: { consumes: ['x'] } }))).toEqual({ errors: [], warnings: [] });
  });

  it('the dev and QA pair, undeclared: an error naming both sections, the types and both remedies', () => {
    const f = loopFindings(def(PAIR));
    expect(f.warnings).toEqual([]);
    expect(f.errors).toHaveLength(1);
    expect(f.errors[0]).toContain('sections.development, sections.qa');
    expect(f.errors[0]).toContain('"development", "qa"');
    expect(f.errors[0]).toContain('"build", "report"');
    expect(f.errors[0]).toContain('declare it: loops:');
    expect(f.errors[0]).toContain('or break the cycle');
  });

  it('the same pair declared: passes with no finding, and classifies as covered by loop 0', () => {
    const d = def(PAIR, [PAIR_LOOP]);
    expect(loopFindings(d)).toEqual({ errors: [], warnings: [] });
    expect(classifyCycles(d).map((c) => c.loops)).toEqual([[0]]);
    expect(classifyCycles(def(PAIR)).map((c) => c.loops)).toEqual([[]]);
  });

  it('the three-section ring: undeclared fails, declared passes, a loop naming only two of the three still fails', () => {
    expect(codes(def(RING))).toEqual(['CYCLE_UNDECLARED']);
    expect(codes(def(RING, [{ between: ['a', 'b', 'c'], types: ['xa', 'yb', 'zc'], max_rounds: 2 }]))).toEqual([]);
    expect(codes(def(RING, [{ between: ['a', 'b'], types: ['xa'], max_rounds: 2 }]))).toEqual(['CYCLE_UNDECLARED', 'LOOP_NO_CYCLE']);
  });

  it('one loop may cover several components when it names every section of each', () => {
    const d = def(
      {
        a: { consumes: ['y'], publishes: ['x'] },
        b: { consumes: ['x'], publishes: ['y'] },
        c: { consumes: ['q'], publishes: ['p'] },
        d: { consumes: ['p'], publishes: ['q'] },
      },
      [{ between: ['a', 'b', 'c', 'd'], types: ['x', 'y'], max_rounds: 3 }],
    );
    expect(codes(d)).toEqual([]);
  });

  it('one undeclared cycle of two is reported once, with the declared one silent', () => {
    const d = def(
      {
        a: { consumes: ['y'], publishes: ['x'] },
        b: { consumes: ['x'], publishes: ['y'] },
        c: { consumes: ['q'], publishes: ['p'] },
        d: { consumes: ['p'], publishes: ['q'] },
      },
      [{ between: ['a', 'b'], types: ['x'], max_rounds: 3 }],
    );
    const f = loopFindings(d);
    expect(f.errors).toHaveLength(1);
    expect(f.errors[0]).toContain('sections.c, sections.d');
  });

  it('a self-edge cannot be declared: it is its own error with the removal remedy, even next to a loop', () => {
    const d = def({ a: { consumes: ['x'], publishes: ['x'] } }, [{ between: ['a', 'a'], types: ['x'], max_rounds: 2 }]);
    expect(codes(d)).toContain('CYCLE_SELF_EDGE');
    const p = loopProblems(d).find((x) => x.code === 'CYCLE_SELF_EDGE');
    expect(p?.path).toBe('sections.a');
    expect(p?.remedy).toContain('remove the type');
  });

  it('every finding string is path, message and remedy', () => {
    for (const s of loopFindings(def(PAIR, [{ between: ['qa'], types: [], max_rounds: 0 }])).errors) expect(s).toMatch(/^[^:]+: .+ — .+/);
  });
});

describe('loops entries: shape, names, types, rounds', () => {
  const ok = def(PAIR);
  const withLoop = (entry: unknown) => def(PAIR, [entry]);

  it.each<[string, unknown, LoopCode]>([
    ['not an object', 'x', 'LOOP_NOT_OBJECT'],
    ['null', null, 'LOOP_NOT_OBJECT'],
    ['a list', [], 'LOOP_NOT_OBJECT'],
    ['an unknown field', { ...PAIR_LOOP, escalate: 'root' }, 'LOOP_UNKNOWN_FIELD'],
    ['between missing', { types: ['build'], max_rounds: 2 }, 'LOOP_BETWEEN_INVALID'],
    ['between a string', { ...PAIR_LOOP, between: 'development' }, 'LOOP_BETWEEN_INVALID'],
    ['between of one section', { ...PAIR_LOOP, between: ['qa'] }, 'LOOP_BETWEEN_INVALID'],
    ['between with a repeat', { ...PAIR_LOOP, between: ['qa', 'qa'] }, 'LOOP_BETWEEN_INVALID'],
    ['between with a non-string', { ...PAIR_LOOP, between: ['qa', 3] }, 'LOOP_BETWEEN_INVALID'],
    ['an unknown section', { ...PAIR_LOOP, between: ['development', 'ops'] }, 'LOOP_SECTION_UNKNOWN'],
    ['types missing', { between: ['development', 'qa'], max_rounds: 2 }, 'LOOP_TYPES_INVALID'],
    ['types empty', { ...PAIR_LOOP, types: [] }, 'LOOP_TYPES_INVALID'],
    ['types with a repeat', { ...PAIR_LOOP, types: ['build', 'build'] }, 'LOOP_TYPES_INVALID'],
    ['an unknown type', { ...PAIR_LOOP, types: ['build', 'ghost'] }, 'LOOP_TYPE_UNKNOWN'],
    ['max_rounds missing', { between: PAIR_LOOP.between, types: PAIR_LOOP.types }, 'LOOP_ROUNDS_INVALID'],
    ['max_rounds zero', { ...PAIR_LOOP, max_rounds: 0 }, 'LOOP_ROUNDS_INVALID'],
    ['max_rounds negative', { ...PAIR_LOOP, max_rounds: -1 }, 'LOOP_ROUNDS_INVALID'],
    ['max_rounds fractional', { ...PAIR_LOOP, max_rounds: 1.5 }, 'LOOP_ROUNDS_INVALID'],
    ['max_rounds a string', { ...PAIR_LOOP, max_rounds: '3' }, 'LOOP_ROUNDS_INVALID'],
    ['max_rounds NaN', { ...PAIR_LOOP, max_rounds: Number.NaN }, 'LOOP_ROUNDS_INVALID'],
  ])('%s is an error with code %s', (_n, entry, code) => {
    const p = loopProblems(withLoop(entry)).filter((x) => x.severity === 'error');
    expect(p.map((x) => x.code)).toContain(code);
    for (const x of p) {
      expect(x.path).toMatch(/^(loops\[0\]|sections\.)/);
      expect(x.remedy.length).toBeGreaterThan(10);
    }
  });

  it('max_rounds of 1 and a large value are accepted', () => {
    expect(codes(withLoop({ ...PAIR_LOOP, max_rounds: 1 }))).toEqual([]);
    expect(codes(withLoop({ ...PAIR_LOOP, max_rounds: 1000 }))).toEqual([]);
  });

  it('a type that exists but is not handed between the loop sections is outside the cycle', () => {
    const d = def(
      { ...PAIR, docs: { consumes: ['spec'] }, writer: { publishes: ['spec'] } },
      [{ between: ['development', 'qa'], types: ['build', 'spec'], max_rounds: 2 }],
    );
    const p = loopProblems(d).filter((x) => x.code === 'LOOP_TYPE_OUTSIDE');
    expect(p).toHaveLength(1);
    expect(p[0].message).toContain('"spec"');
    expect(p[0].path).toBe('loops[0].types');
  });

  it('a type handed in only one direction between the loop sections is still an edge inside it', () => {
    expect(codes(withLoop({ ...PAIR_LOOP, types: ['build'] }))).toEqual([]);
  });

  it('a type published and consumed but outside any of its own edges (type of another pair) is outside', () => {
    const d = def(
      { ...PAIR, ops: { publishes: ['alert'] }, pager: { consumes: ['alert'] } },
      [{ between: ['development', 'qa'], types: ['alert'], max_rounds: 2 }],
    );
    expect(codes(d)).toContain('LOOP_TYPE_OUTSIDE');
  });

  it('loops that is not a list is one error and no crash', () => {
    for (const bad of [{}, 'x', 3, null]) expect(codes(def(PAIR, bad))).toEqual(['LOOPS_NOT_LIST', 'CYCLE_UNDECLARED']);
  });

  it('loops absent and loops an empty list behave the same on an acyclic org', () => {
    const a = def({ a: { publishes: ['x'] }, b: { consumes: ['x'] } });
    expect(loopProblems(a)).toEqual([]);
    expect(loopProblems(def({ a: { publishes: ['x'] }, b: { consumes: ['x'] } }, []))).toEqual([]);
  });

  it('a malformed entry still declares the cycle when its between is usable, so the cycle is not reported twice', () => {
    expect(codes(withLoop({ ...PAIR_LOOP, max_rounds: 0 }))).toEqual(['LOOP_ROUNDS_INVALID']);
  });

  it('the valid base definition has no problem', () => {
    expect(loopProblems(withLoop(PAIR_LOOP))).toEqual([]);
    expect(ok).toBeTruthy();
  });
});

describe('overlap, no-cycle and extra-section findings', () => {
  it('two loops that share a section overlap: an error on the later one', () => {
    const d = def(RING, [
      { between: ['a', 'b', 'c'], types: ['xa'], max_rounds: 2 },
      { between: ['c', 'a'], types: ['zc'], max_rounds: 2 },
    ]);
    const p = loopProblems(d).filter((x) => x.code === 'LOOP_OVERLAP');
    expect(p).toHaveLength(1);
    expect(p[0].path).toBe('loops[1].between');
    expect(p[0].message).toContain('loops[0]');
    expect(p[0].message).toContain('"a", "c"');
  });

  it('two identical loops overlap', () => {
    expect(codes(def(PAIR, [PAIR_LOOP, PAIR_LOOP]))).toContain('LOOP_OVERLAP');
  });

  it('three loops: every overlapping pair is reported against the later entry', () => {
    const three = def(
      { ...PAIR, c: { publishes: ['cx'] }, d: { consumes: ['cx'] } },
      [PAIR_LOOP, { ...PAIR_LOOP }, { ...PAIR_LOOP }],
    );
    expect(loopProblems(three).filter((x) => x.code === 'LOOP_OVERLAP').map((x) => x.path)).toEqual([
      'loops[1].between',
      'loops[2].between',
      'loops[2].between',
    ]);
  });

  it('loops on disjoint sections do not overlap', () => {
    const d = def(
      {
        a: { consumes: ['y'], publishes: ['x'] },
        b: { consumes: ['x'], publishes: ['y'] },
        c: { consumes: ['q'], publishes: ['p'] },
        d: { consumes: ['p'], publishes: ['q'] },
      },
      [
        { between: ['a', 'b'], types: ['x', 'y'], max_rounds: 2 },
        { between: ['c', 'd'], types: ['p', 'q'], max_rounds: 3 },
      ],
    );
    expect(loopProblems(d)).toEqual([]);
  });

  it('a loop between two sections that hand documents one way only is a warning (it bounds nothing), not an error', () => {
    const d = def({ a: { publishes: ['x'] }, b: { consumes: ['x'] } }, [{ between: ['a', 'b'], types: ['x'], max_rounds: 2 }]);
    const f = loopFindings(d);
    expect(f.errors).toEqual([]);
    expect(f.warnings).toHaveLength(1);
    expect(loopProblems(d)[0]).toMatchObject({ code: 'LOOP_NO_CYCLE', severity: 'warning', path: 'loops[0]' });
  });

  it('a loop that names a section outside the cycle it covers gets a warning naming the extra one', () => {
    const d = def({ ...PAIR, other: { publishes: ['o'] }, sink: { consumes: ['o'] } }, [
      { between: ['development', 'qa', 'sink'], types: ['build', 'report'], max_rounds: 2 },
    ]);
    const p = loopProblems(d);
    expect(p.map((x) => [x.code, x.severity])).toEqual([['LOOP_EXTRA_SECTION', 'warning']]);
    expect(p[0].message).toContain('"sink"');
  });
});

describe('declaredLoops: the well-formed entries', () => {
  it('returns each good entry with its list position, sorted between', () => {
    const d = def(PAIR, [{ between: ['qa', 'development'], types: ['report', 'build'], max_rounds: 4 }]);
    expect(declaredLoops(d)).toEqual([{ index: 0, between: ['development', 'qa'], types: ['report', 'build'], max_rounds: 4 }]);
  });

  it('skips an entry with any error and keeps the position of the others', () => {
    const d = def(PAIR, [{ between: ['qa'], types: [], max_rounds: 0 }, PAIR_LOOP]);
    expect(declaredLoops(d).map((l) => l.index)).toEqual([1]);
  });

  it('is empty without a loops key', () => {
    expect(declaredLoops(def(PAIR))).toEqual([]);
  });
});

describe('typed codes', () => {
  it('every code is unique and every problem the table cases produce uses a listed one', () => {
    expect(new Set(LOOP_CODES).size).toBe(LOOP_CODES.length);
    const seen = new Set<LoopCode>();
    for (const d of [
      def(PAIR),
      def(PAIR, 'x'),
      def({ a: { consumes: ['x'], publishes: ['x'] } }),
      def(PAIR, [{ between: ['a'], types: 1, max_rounds: 0, z: 1 }, 7]),
      def(PAIR, [PAIR_LOOP, PAIR_LOOP]),
      def({ a: { publishes: ['x'] }, b: { consumes: ['x'] } }, [{ between: ['a', 'b'], types: ['x'], max_rounds: 2 }]),
    ])
      for (const p of loopProblems(d)) seen.add(p.code);
    for (const c of seen) expect(LOOP_CODES).toContain(c);
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it('the functions accept a parsed OrgDef as they accept a literal', () => {
    const parsed = OrgDefSchema.parse({
      name: 'x',
      roles: [{ id: 'boss', type: 'boss', name: 'b', adapter: 'claude-local' }],
      ...(def(PAIR, [PAIR_LOOP]) as object),
    });
    expect(loopProblems(parsed)).toEqual([]);
    expect(cycles(parsed)).toHaveLength(1);
  });
});
