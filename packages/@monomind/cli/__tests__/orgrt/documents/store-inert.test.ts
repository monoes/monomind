import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
const orgrt = join(src, 'orgrt');
const documents = join(orgrt, 'documents');
const STORE = [
  'store',
  'store-types',
  'store-common',
  'store-publish',
  'store-decide',
  'store-validate',
  'events',
  'state',
  'snapshot',
  'durable-fs',
];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|mts|mjs|js|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );

describe('the document store is inert (P3.5): nothing outside documents/ constructs or imports it', () => {
  it('no file outside orgrt/documents imports a store module', () => {
    const targets = STORE.map((n) => join(documents, n));
    const bad = walk(src)
      .filter((f) => !f.startsWith(documents + sep))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/from\s+['"](\.[^'"]*)['"]/g)]
          .map((m) => ({ f, target: resolve(dirname(f), m[1]).replace(/\.(js|ts)$/, '') }))
          .filter((r) => targets.includes(r.target) || r.target === documents),
      )
      .map((r) => relative(src, r.f));
    expect(bad).toEqual([]);
  });

  it('the store modules import only from documents/ and node builtins', () => {
    for (const n of STORE) {
      const text = readFileSync(join(documents, `${n}.ts`), 'utf8');
      for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g))
        expect(m[1].startsWith('./') || m[1].startsWith('node:'), `${n}: ${m[1]}`).toBe(true);
    }
  });

  it('a store never touches the state layout of an org that has no sections: it creates files only under the dir it is given', () => {
    const text = readFileSync(join(documents, 'store.ts'), 'utf8');
    expect(text).not.toMatch(/homedir|process\.env|\.monomind/);
  });
});
