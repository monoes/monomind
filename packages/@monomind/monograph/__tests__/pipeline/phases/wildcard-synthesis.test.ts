import { describe, it, expect } from 'vitest';
import {
  extractWildcardBindings,
  extractWildcardMemberAccesses,
  synthesizeWildcardImports,
} from '../../../src/pipeline/phases/wildcard-synthesis.js';
import type { MonographNode, MonographEdge } from '../../../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<MonographNode> & { id: string; name: string }): MonographNode {
  return {
    label: 'Function',
    normLabel: overrides.name.toLowerCase(),
    isExported: true,
    ...overrides,
  };
}

// ── extractWildcardBindings ───────────────────────────────────────────────────

describe('extractWildcardBindings', () => {
  it('detects a single wildcard import with single quotes', () => {
    const src = `import * as utils from './utils';`;
    const bindings = extractWildcardBindings(src);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual({ alias: 'utils', moduleSpecifier: './utils' });
  });

  it('detects a wildcard import with double quotes', () => {
    const src = `import * as helpers from "../helpers"`;
    const bindings = extractWildcardBindings(src);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual({ alias: 'helpers', moduleSpecifier: '../helpers' });
  });

  it('detects multiple wildcard imports', () => {
    const src = [
      `import * as ns1 from './module-a';`,
      `import * as ns2 from './module-b';`,
      `import { foo } from './module-c';`,
    ].join('\n');
    const bindings = extractWildcardBindings(src);
    expect(bindings).toHaveLength(2);
    expect(bindings.map(b => b.alias)).toEqual(['ns1', 'ns2']);
  });

  it('returns empty array when no wildcard imports exist', () => {
    const src = `import { foo, bar } from './utils';\nimport DefaultExport from './default';`;
    expect(extractWildcardBindings(src)).toHaveLength(0);
  });

  it('is not confused by regular imports containing "as"', () => {
    const src = `import { foo as bar } from './utils';`;
    expect(extractWildcardBindings(src)).toHaveLength(0);
  });
});

// ── extractWildcardMemberAccesses ─────────────────────────────────────────────

describe('extractWildcardMemberAccesses', () => {
  it('detects a simple member access', () => {
    const src = `const x = ns.foo();`;
    const accesses = extractWildcardMemberAccesses(src, 'ns');
    expect(accesses).toHaveLength(1);
    expect(accesses[0]).toMatchObject({ alias: 'ns', member: 'foo', line: 1 });
  });

  it('detects multiple different members on different lines', () => {
    const src = [`ns.alpha();`, `ns.beta = 1;`, `console.log(ns.gamma);`].join('\n');
    const accesses = extractWildcardMemberAccesses(src, 'ns');
    expect(accesses.map(a => a.member)).toEqual(['alpha', 'beta', 'gamma']);
    expect(accesses.map(a => a.line)).toEqual([1, 2, 3]);
  });

  it('deduplicates the same member accessed multiple times on the same line', () => {
    const src = `if (ns.enabled && ns.enabled) {}`;
    const accesses = extractWildcardMemberAccesses(src, 'ns');
    const enabledAccesses = accesses.filter(a => a.member === 'enabled');
    expect(enabledAccesses).toHaveLength(1);
  });

  it('does not match a different namespace with similar prefix', () => {
    const src = `nsExtra.foo(); ns.bar();`;
    const accesses = extractWildcardMemberAccesses(src, 'ns');
    expect(accesses.map(a => a.member)).toEqual(['bar']);
  });

  it('returns empty array when alias is never used as a member accessor', () => {
    const src = `const ns = 1;\nconsole.log(ns);`;
    expect(extractWildcardMemberAccesses(src, 'ns')).toHaveLength(0);
  });
});

// ── synthesizeWildcardImports ─────────────────────────────────────────────────

describe('synthesizeWildcardImports', () => {
  it('creates an IMPORTS edge from source file to the accessed exported symbol', () => {
    const src = [
      `import * as utils from './utils';`,
      `utils.formatDate();`,
    ].join('\n');

    const nodes: MonographNode[] = [
      makeNode({ id: 'fn:src/utils.ts:formatDate', name: 'formatDate', filePath: 'src/utils.ts' }),
    ];

    const result = synthesizeWildcardImports('file:src/app.ts', src, nodes, []);

    expect(result.synthesizedEdges).toHaveLength(1);
    const edge = result.synthesizedEdges[0];
    expect(edge.sourceId).toBe('file:src/app.ts');
    expect(edge.targetId).toBe('fn:src/utils.ts:formatDate');
    expect(edge.relation).toBe('IMPORTS');
    expect(edge.confidence).toBe('INFERRED');
  });

  it('creates edges for multiple member accesses', () => {
    const src = [
      `import * as math from './math';`,
      `math.add(1, 2);`,
      `math.subtract(5, 3);`,
    ].join('\n');

    const nodes: MonographNode[] = [
      makeNode({ id: 'fn:src/math.ts:add', name: 'add' }),
      makeNode({ id: 'fn:src/math.ts:subtract', name: 'subtract' }),
    ];

    const result = synthesizeWildcardImports('file:src/calc.ts', src, nodes, []);

    const memberNames = result.synthesizedEdges.map(e => {
      const target = nodes.find(n => n.id === e.targetId);
      return target?.name;
    });
    expect(memberNames.sort()).toEqual(['add', 'subtract']);
  });

  it('does not create edges for non-exported symbols', () => {
    const src = [
      `import * as internal from './internal';`,
      `internal.privateHelper();`,
    ].join('\n');

    const nodes: MonographNode[] = [
      makeNode({ id: 'fn:src/internal.ts:privateHelper', name: 'privateHelper', isExported: false }),
    ];

    const result = synthesizeWildcardImports('file:src/consumer.ts', src, nodes, []);
    expect(result.synthesizedEdges).toHaveLength(0);
  });

  it('does not duplicate edges that already exist', () => {
    const src = [
      `import * as utils from './utils';`,
      `utils.helper();`,
    ].join('\n');

    const nodes: MonographNode[] = [
      makeNode({ id: 'fn:src/utils.ts:helper', name: 'helper' }),
    ];

    const existingEdge: MonographEdge = {
      id: 'file_src_app_ts_fn_src_utils_ts_helper_wildcard_helper',
      sourceId: 'file:src/app.ts',
      targetId: 'fn:src/utils.ts:helper',
      relation: 'IMPORTS',
      confidence: 'INFERRED',
      confidenceScore: 0.5,
    };

    const result = synthesizeWildcardImports('file:src/app.ts', src, nodes, [existingEdge]);
    expect(result.synthesizedEdges).toHaveLength(0);
  });

  it('returns empty result when there are no wildcard imports', () => {
    const src = `import { foo } from './utils';\nfoo();`;
    const nodes: MonographNode[] = [
      makeNode({ id: 'fn:src/utils.ts:foo', name: 'foo' }),
    ];
    const result = synthesizeWildcardImports('file:src/app.ts', src, nodes, []);
    expect(result.synthesizedEdges).toHaveLength(0);
  });

  it('handles multiple wildcard imports from different modules', () => {
    const src = [
      `import * as a from './module-a';`,
      `import * as b from './module-b';`,
      `a.alpha();`,
      `b.beta();`,
    ].join('\n');

    const nodes: MonographNode[] = [
      makeNode({ id: 'fn:src/module-a.ts:alpha', name: 'alpha' }),
      makeNode({ id: 'fn:src/module-b.ts:beta', name: 'beta' }),
    ];

    const result = synthesizeWildcardImports('file:src/consumer.ts', src, nodes, []);
    expect(result.synthesizedEdges).toHaveLength(2);
  });

  it('returns empty result when source is empty', () => {
    expect(synthesizeWildcardImports('file:src/empty.ts', '', [], [])).toEqual({
      synthesizedEdges: [],
    });
  });
});
