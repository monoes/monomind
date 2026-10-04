import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
const orgrt = join(src, 'orgrt');
const documents = join(orgrt, 'documents');

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|mts|mjs|js|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );

describe('orgrt/documents is inert (P3.4): nothing outside it imports it yet', () => {
  it('no file under src/orgrt outside documents/ refers to the documents directory', () => {
    const offenders = walk(orgrt)
      .filter((f) => !f.startsWith(documents + sep))
      .filter((f) =>
        [...readFileSync(f, 'utf8').matchAll(/['"](\.[^'"]*\/documents(?:\/[^'"]*)?)['"]/g)].some((m) => {
          const target = resolve(dirname(f), m[1]);
          return target === documents || target.startsWith(documents + sep);
        }),
      )
      .map((f) => relative(src, f));
    expect(offenders).toEqual([]);
  });

  it('the P3.4 modules import nothing from the rest of orgrt or the CLI (pure, self-contained)', () => {
    const bad: string[] = [];
    const p34 = ['errors', 'json', 'schema-dialect', 'schema-ref', 'checks', 'canonical', 'contract', 'types'];
    for (const f of p34.map((n) => join(documents, `${n}.ts`)))
      for (const m of readFileSync(f, 'utf8').matchAll(/from\s+['"](\.[^'"]*)['"]/g)) {
        const target = resolve(dirname(f), m[1]);
        if (!(target === documents || target.startsWith(documents + sep))) bad.push(`${relative(src, f)} -> ${m[1]}`);
      }
    expect(bad).toEqual([]);
  });

  it('does not use eval, Function, child_process or the network', () => {
    for (const f of walk(documents)) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/\beval\s*\(|new Function\s*\(|child_process|node:net|node:http|fetch\s*\(/);
    }
  });

  it('every file stays under 500 lines', () => {
    for (const f of walk(documents)) expect(readFileSync(f, 'utf8').split('\n').length, f).toBeLessThan(500);
  });
});
