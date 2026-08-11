import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { parseFile } from '../../src/parsers/loader.js';

// MONO-2 regression: tree-sitter recovers from malformed input by inserting
// ERROR/MISSING nodes and still returns a tree — so `parseFile` used to report
// `parseErrors: []` even when the recovered tree had silently dropped or
// mis-shapen symbols. The grammar-load-failure path was similarly silent: a
// broken native module produced an empty result that looked identical to a
// successful parse of an empty file.

describe('MONO-2: tree-sitter recovery surfaces a parseError', () => {
  it('flags a malformed TypeScript file (recovered, but reported)', async () => {
    // Missing close brace + garbage token forces tree-sitter to insert ERROR/MISSING nodes.
    const broken = `function broken( {\n  return;\n`;
    const r = await parseFile('/repo/broken.ts', broken, 'broken.ts');
    // The extractor still produces *partial* results from the recovered tree,
    // which is the desired behavior (some signal > no signal). But the parseError
    // entry now lets callers tell recovery happened.
    expect(r.parseErrors.length).toBeGreaterThanOrEqual(1);
    expect(r.parseErrors.some(e => e.includes('broken.ts'))).toBe(true);
  });

  it('emits no parseErrors for clean TypeScript', async () => {
    const clean = `export function add(a: number, b: number): number { return a + b; }\n`;
    const r = await parseFile('/repo/clean.ts', clean, 'clean.ts');
    expect(r.parseErrors).toHaveLength(0);
    expect(r.nodes.length).toBeGreaterThan(0);
  });
});

describe('MONO-2: grammar-load-failure surfaces a parseError', () => {
  it('reports grammar load failure when a native tree-sitter module is broken', async () => {
    // We simulate a corrupted/ABI-mismatched tree-sitter-kotlin native module
    // by poisoning Node's require cache. The fresh loader import (after
    // vi.resetModules) has an empty parserCache, so getParser must call
    // config.getLanguage() → require('tree-sitter-kotlin') → throws.
    //
    // vi.resetModules clears vitest's ESM registry so loader.ts / kotlin.ts are
    // re-evaluated fresh; Node's native require cache for tree-sitter-kotlin is
    // shared across all require instances, so the poison affects the fresh
    // module too.
    vi.resetModules();

    const require = createRequire(import.meta.url);
    const moduleId = require.resolve('tree-sitter-kotlin');
    const original = require.cache[moduleId];

    // Replace the cached export with a throwing proxy so any access (including
    // the `mod.language ?? mod` pattern in kotlin.ts) blows up.
    require.cache[moduleId] = new Proxy({}, {
      get() { throw new Error('simulated grammar load failure'); },
    }) as typeof original;

    try {
      const loaderModule = await import('../../src/parsers/loader.js');
      const r = await loaderModule.parseFile('/repo/Foo.kt', 'class Foo {}\n', 'Foo.kt');
      expect(r.parseErrors.length).toBeGreaterThanOrEqual(1);
      expect(r.parseErrors.some(e => /kotlin.*grammar load failed/i.test(e))).toBe(true);
      expect(r.nodes).toHaveLength(0);
    } finally {
      // Restore so other tests in the suite aren't poisoned.
      if (original !== undefined) {
        require.cache[moduleId] = original;
      } else {
        delete require.cache[moduleId];
      }
      vi.resetModules();
    }
  });
});
