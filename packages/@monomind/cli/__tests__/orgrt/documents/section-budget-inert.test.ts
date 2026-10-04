// packages/@monomind/cli/__tests__/orgrt/documents/section-budget-inert.test.ts
// P4.1: the section budget core is inert. Nothing outside the three new files imports them (the plan names no
// re-export), and they import only each other, `import type`s and node builtins, so they cannot reach the
// daemon, a clock, the environment or the filesystem.
// EDITED BY P4.5: the allowlist names the two wiring modules (the only importers; the daemon, the checklist and
// the report import those, never the core), so a third importer still shows.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
const documents = join(src, 'orgrt', 'documents');
const FILES = ['section-budget', 'section-budget-findings', 'section-budget-status'];
/** Files outside the three allowed to import them: the two P4.5 wiring modules. */
const ALLOWED_IMPORTERS: string[] = [
  join('orgrt', 'documents', 'section-budget-wire.ts'),
  join('orgrt', 'documents', 'section-budget-report.ts'),
];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|mts|mjs|js|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );

const importsOf = (text: string): Array<{ spec: string; typeOnly: boolean }> =>
  [...text.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => ({
    spec: m[2],
    typeOnly: m[1] !== undefined,
  }));

describe('the section budget core is inert (P4.1)', () => {
  it('no source file outside the three imports them, through a path or a documents/ barrel', () => {
    const targets = FILES.map((n) => join(documents, n));
    const own = new Set(FILES.map((n) => join(documents, `${n}.ts`)));
    const bad = walk(src)
      .filter((f) => !own.has(f))
      .flatMap((f) =>
        importsOf(readFileSync(f, 'utf8'))
          .filter((i) => i.spec.startsWith('.'))
          .map((i) => ({ f, target: resolve(dirname(f), i.spec).replace(/\.(js|ts)$/, '') }))
          .filter((r) => targets.includes(r.target))
          .map((r) => relative(src, r.f)),
      )
      .filter((f) => !ALLOWED_IMPORTERS.includes(f));
    expect(bad).toEqual([]);
  });

  it('the documents/ barrel does not re-export them', () => {
    const index = readFileSync(join(documents, 'index.ts'), 'utf8');
    expect(index).not.toMatch(/section-budget/);
  });

  it('the three files import only each other, type-only imports and node builtins', () => {
    for (const n of FILES) {
      for (const i of importsOf(readFileSync(join(documents, `${n}.ts`), 'utf8'))) {
        const ok =
          i.typeOnly ||
          i.spec.startsWith('node:') ||
          FILES.some((f) => i.spec === `./${f}.js`);
        expect(ok, `${n}: ${i.spec}`).toBe(true);
      }
    }
  });

  it('they read no clock, environment or file and write nothing', () => {
    for (const n of FILES) {
      const text = readFileSync(join(documents, `${n}.ts`), 'utf8');
      expect(text, n).not.toMatch(/process\.env|Date\.now|new Date|Math\.random|performance\.now|node:fs|node:os|homedir/);
    }
  });

  it('each file stays under 500 lines', () => {
    for (const n of FILES)
      expect(readFileSync(join(documents, `${n}.ts`), 'utf8').split('\n').length, n).toBeLessThan(500);
  });
});
