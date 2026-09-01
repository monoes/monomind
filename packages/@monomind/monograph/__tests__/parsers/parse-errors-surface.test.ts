import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  it('reports grammar load failure when the wasm grammar is missing', async () => {
    // Grammars are vendored wasm files loaded from wasm/ (or dist/wasm in the
    // published package). MONOMIND_WASM_DIR redirects the lookup, so pointing
    // it at an empty directory simulates a lost/corrupt grammar install: the
    // fresh loader import (after vi.resetModules) has empty caches, and
    // getParser must fail the wasm load for .kt and surface the reason.
    vi.resetModules();

    const emptyDir = await mkdtemp(join(tmpdir(), 'monomind-no-wasm-'));
    const prev = process.env.MONOMIND_WASM_DIR;
    process.env.MONOMIND_WASM_DIR = emptyDir;

    try {
      const loaderModule = await import('../../src/parsers/loader.js');
      const r = await loaderModule.parseFile('/repo/Foo.kt', 'class Foo {}\n', 'Foo.kt');
      expect(r.parseErrors.length).toBeGreaterThanOrEqual(1);
      expect(r.parseErrors.some(e => /kotlin.*grammar load failed/i.test(e))).toBe(true);
      expect(r.nodes).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.MONOMIND_WASM_DIR;
      else process.env.MONOMIND_WASM_DIR = prev;
      await rm(emptyDir, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
