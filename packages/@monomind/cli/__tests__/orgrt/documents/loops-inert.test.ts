// packages/@monomind/cli/__tests__/orgrt/documents/loops-inert.test.ts
// P4.3: the loops core is inert. Nothing outside its own two files and its tests imports it, so no org, no
// golden and no pin can move until P4.7 and P4.8 wire it (the plan lists no re-export for this piece). P4.8 has
// wired it: the first test names the three files that may import it now.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
const documents = join(src, 'orgrt', 'documents');
const MODULES = ['loops', 'loop-rounds'];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|mts|mjs|js|cjs|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g)].map((m) =>
    resolve(dirname(file), m[1]).replace(/\.(js|ts)$/, ''),
  );

describe('the loops core is imported only by its wiring (P4.3, P4.8)', () => {
  it('no source file outside loops.ts and loop-rounds.ts imports either of them, and the documents barrel does not', () => {
    const targets = MODULES.map((m) => join(documents, m));
    const own = new Set(MODULES.map((m) => join(documents, `${m}.ts`)));
    const bad = walk(src)
      .filter((f) => !own.has(f))
      .filter((f) => f !== join(documents, 'rework.ts')) // EDITED BY P4.7: the rework cap uses loop-rounds.ts
      // EDITED BY P4.8: the three files that wire loops.ts (definition findings, round enforcement, the loop-type check at open)
      .filter((f) => !['definition.ts', 'loop-run.ts', 'runtime.ts'].some((n) => f === join(documents, n)))
      .filter((f) => importsOf(f).some((t) => targets.includes(t)))
      .map((f) => relative(src, f));
    expect(bad).toEqual([]);
    expect(readFileSync(join(documents, 'index.ts'), 'utf8')).not.toMatch(/loops|loop-rounds/);
  });

  it('the one user of the core, rework.ts (P4.7), takes the round rules only and not the loops key', () => {
    const text = readFileSync(join(documents, 'rework.ts'), 'utf8');
    expect([...new Set([...text.matchAll(/from\s+['"](\.\/loop[^'"]*)['"]/g)].map((x) => x[1]))]).toEqual(['./loop-rounds.js']);
  });

  it('the two files are pure: they import only each other, the definition helpers, the state reducer and nothing from node', () => {
    const allowed = new Set(['./loop-rounds.js', './loops.js', './definition-util.js', './state.js']);
    for (const m of MODULES) {
      const text = readFileSync(join(documents, `${m}.ts`), 'utf8');
      for (const x of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) expect(allowed.has(x[1]), `${m}: ${x[1]}`).toBe(true);
      expect(text, m).not.toMatch(/process\.|Date\.now|new Date|Math\.random|readFileSync|homedir/);
    }
  });

  it('both files stay under the 500-line limit', () => {
    for (const m of MODULES) expect(readFileSync(join(documents, `${m}.ts`), 'utf8').split('\n').length).toBeLessThan(500);
  });
});
