// packages/@monomind/cli/__tests__/orgrt/documents/writer-inert.test.ts
// P4.2: the writer core is inert until P4.4 wires it. Nothing in src/ outside the writer files may import them
// (the allowlist is empty: the plan names no re-export line for this piece), and they stay pure: no file system,
// process, network or clock, and every file under 500 lines.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
const documents = join(src, 'orgrt', 'documents');
const WRITER_FILES = ['writer-paths', 'writer-text', 'writer-overlay', 'writer-policy'];
/** Files outside the writer files that may import them. Empty: documents/index.ts gets no re-export in P4.2. */
const ALLOWED_IMPORTERS: string[] = [];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|mts|mjs|js|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const isWriterFile = (f: string) => WRITER_FILES.includes(basename(f).replace(/\.(ts|js)$/, ''));
const importsOf = (text: string): string[] =>
  [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('the writer core is inert (P4.2)', () => {
  it('the four writer files exist', () => {
    for (const n of WRITER_FILES) expect(walk(documents).some((f) => basename(f) === `${n}.ts`), n).toBe(true);
  });

  it('no file outside the writer files imports one of them, apart from the allowlist', () => {
    const importers: string[] = [];
    for (const f of walk(src)) {
      if (isWriterFile(f)) continue;
      for (const spec of importsOf(readFileSync(f, 'utf8')))
        if (spec.startsWith('.') && WRITER_FILES.includes(basename(spec).replace(/\.(ts|js)$/, '')))
          importers.push(relative(src, f));
    }
    expect(importers.sort()).toEqual([...ALLOWED_IMPORTERS].sort());
  });

  it('the writer files import only node:path, the policy path helpers, the types and each other, routing and surface', () => {
    const allowed = new Set([
      'node:path',
      '../policy-paths.js',
      '../policy-scopes.js',
      '../types.js',
      './routing.js',
      './surface.js',
      ...WRITER_FILES.map((n) => `./${n}.js`),
    ]);
    for (const n of WRITER_FILES)
      for (const spec of importsOf(readFileSync(join(documents, `${n}.ts`), 'utf8')))
        expect(allowed.has(spec), `${n}.ts imports ${spec}`).toBe(true);
  });

  it('the writer files do not use the file system, processes, the network, time or randomness', () => {
    for (const n of WRITER_FILES) {
      const text = readFileSync(join(documents, `${n}.ts`), 'utf8');
      expect(text, n).not.toMatch(/node:fs|child_process|node:net|node:http|fetch\s*\(|Date\.now|new Date|Math\.random|process\.env|\beval\s*\(/);
    }
  });

  it('every writer file stays under 500 lines', () => {
    for (const n of WRITER_FILES)
      expect(readFileSync(join(documents, `${n}.ts`), 'utf8').split('\n').length, n).toBeLessThan(500);
  });
});
