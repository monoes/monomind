import { describe, it, expect } from 'vitest';
import { chunkSource } from '../../src/search/ast-chunker.js';

describe('chunkSource', () => {
  it('returns empty array for empty source', () => {
    expect(chunkSource('')).toEqual([]);
  });

  it('detects import chunk kind', () => {
    const src = `import { foo } from './foo.js';\nimport { bar } from './bar.js';`;
    const chunks = chunkSource(src);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].kind).toBe('import');
    expect(chunks[0].startLine).toBe(1);
  });

  it('detects function chunk kind', () => {
    const src = `function myFn() {\n  return 42;\n}`;
    const chunks = chunkSource(src);
    const fn = chunks.find(c => c.kind === 'function');
    expect(fn).toBeDefined();
  });

  it('detects class chunk kind', () => {
    const src = `class MyClass {\n  constructor() {}\n}`;
    const chunks = chunkSource(src);
    const cls = chunks.find(c => c.kind === 'class');
    expect(cls).toBeDefined();
  });

  it('detects comment block kind', () => {
    const src = `// This is a comment\n// spanning two lines\nconst x = 1;`;
    const chunks = chunkSource(src);
    const comment = chunks.find(c => c.kind === 'comment');
    expect(comment).toBeDefined();
  });

  it('splits oversized chunk with overlap', () => {
    // Create a source that is definitely > 512 tokens (>2048 chars)
    const bigFn = `function big() {\n` + '  const x = 1;\n'.repeat(200) + `}`;
    const chunks = chunkSource(bigFn, { maxTokens: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    // Adjacent chunks should overlap
    const c0end = chunks[0].endLine;
    const c1start = chunks[1].startLine;
    expect(c1start).toBeLessThanOrEqual(c0end);
  });

  it('discards chunks smaller than minTokens', () => {
    const src = `const x = 1;`; // ~3 tokens
    const chunks = chunkSource(src, { minTokens: 100 });
    expect(chunks).toHaveLength(0);
  });

  it('1-based line numbers are accurate', () => {
    const src = `import { a } from 'a';\n\nfunction foo() {\n  return 1;\n}`;
    const chunks = chunkSource(src);
    for (const c of chunks) {
      expect(c.startLine).toBeGreaterThanOrEqual(1);
      expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
    }
  });
});
