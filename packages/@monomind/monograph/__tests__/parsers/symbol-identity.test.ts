import { parseFile } from '../../src/parsers/loader.js';
import { SYMBOL_ID_VERSION, makeId, symbolId } from '../../src/types.js';

/** Symbol nodes only — File nodes have their own scheme, covered by file-identity.test.ts. */
async function symbolIdsOf(repoRelativePath: string, source: string): Promise<string[]> {
  const result = await parseFile(`/tmp/${repoRelativePath}`, source, repoRelativePath);
  return result.nodes.filter((n) => n.label !== 'File').map((n) => n.id);
}

describe('symbol identity — extraction', () => {
  it('gives symbols in a-b.ts and a_b.ts distinct IDs', async () => {
    const source = 'export function run() { return 1; }\n';
    const dashed = await symbolIdsOf('src/a-b.ts', source);
    const underscored = await symbolIdsOf('src/a_b.ts', source);

    expect(dashed).toHaveLength(1);
    expect(underscored).toHaveLength(1);
    // Old scheme mangled both paths to `a_b_ts`, producing one shared ID.
    expect(dashed[0]).not.toBe(underscored[0]);
  });

  it('gives First.run and Second.run in one file distinct IDs', async () => {
    const ids = await symbolIdsOf(
      'src/two-classes.ts',
      ['class First { run() { return 1; } }', 'class Second { run() { return 2; } }', ''].join('\n'),
    );

    // Two classes plus their two methods, all distinct.
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('keeps a same-named symbol distinct at different lexical scopes', async () => {
    const ids = await symbolIdsOf(
      'src/nested.ts',
      [
        'export function handler() { return 1; }',
        'class Outer {',
        '  handler() { return 2; }',
        '}',
        '',
      ].join('\n'),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('separates repeated declarations of the same name and kind', async () => {
    const ids = await symbolIdsOf(
      'src/overloads.ts',
      ['function pick(a: string) { return a; }', 'function pick(a: number) { return a; }', ''].join(
        '\n',
      ),
    );

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces identical IDs across repeated runs on unchanged input', async () => {
    const source = ['class Repeat {', '  again() { return 1; }', '}', ''].join('\n');
    const first = await symbolIdsOf('src/repeat.ts', source);
    const second = await symbolIdsOf('src/repeat.ts', source);

    expect(second).toEqual(first);
  });
});

describe('symbolId', () => {
  const base = { filePath: 'src/a.ts', scope: [] as string[], name: 'run', kind: 'Function' };

  it('is stable across processes for a fixed tuple', () => {
    // A literal golden value: a hash-based scheme that varied per process (e.g.
    // by seeding from anything ambient) could not keep matching this.
    expect(symbolId(base)).toBe('sym_run_5ceef7296835cd284ccaa515e7db47b5_function');
  });

  it('keeps the _<kind> suffix relationship resolution disambiguates on', () => {
    // pipeline/phases/scope-resolution.ts picks a call target among same-name
    // candidates with id.endsWith('_method' | '_function' | '_class').
    expect(symbolId({ ...base, kind: 'Method' }).endsWith('_method')).toBe(true);
    expect(symbolId({ ...base, kind: 'Function' }).endsWith('_function')).toBe(true);
    expect(symbolId({ ...base, kind: 'Class' }).endsWith('_class')).toBe(true);
    // Constructors must not answer to the _function probe, as before.
    expect(symbolId({ ...base, kind: 'Constructor' }).endsWith('_function')).toBe(false);
  });

  it('survives makeId unchanged, so derived edge IDs stay distinct', () => {
    const dashed = symbolId({ ...base, filePath: 'src/a-b.ts' });
    const underscored = symbolId({ ...base, filePath: 'src/a_b.ts' });

    expect(makeId(dashed)).toBe(dashed);
    expect(makeId(underscored)).toBe(underscored);
    // The distinction must survive into CONTAINS/CALLS edge IDs built via makeId.
    expect(makeId('file', dashed, 'contains')).not.toBe(makeId('file', underscored, 'contains'));
  });

  it('distinguishes every component of the identity tuple', () => {
    const variants = [
      symbolId(base),
      symbolId({ ...base, filePath: 'src/b.ts' }),
      symbolId({ ...base, scope: ['Outer'] }),
      symbolId({ ...base, scope: ['Outer', 'Inner'] }),
      symbolId({ ...base, name: 'runs' }),
      symbolId({ ...base, kind: 'Method' }),
      symbolId({ ...base, overload: 1 }),
    ];

    expect(new Set(variants).size).toBe(variants.length);
  });

  it('cannot be confused by component contents that look like separators', () => {
    // Length-prefixed serialization: a scope entry cannot absorb the next
    // component, however it is punctuated.
    expect(symbolId({ ...base, scope: ['A', 'B'] })).not.toBe(
      symbolId({ ...base, scope: ['A:B'] }),
    );
    expect(symbolId({ ...base, scope: ['A'], name: 'B_run' })).not.toBe(
      symbolId({ ...base, scope: ['A_B'], name: 'run' }),
    );
  });

  it('exports the identity scheme version consumers key caches on', () => {
    // Hashed into every ID, so the golden value above moves when this is bumped.
    expect(SYMBOL_ID_VERSION).toBe(3);
  });
});
