/**
 * Monorepo-wide guard: no bare CJS `require()` in any ESM package's sources.
 *
 * Every package here declares `"type": "module"`, so `require` is undefined at
 * runtime in the built output. A call to it typechecks fine (@types/node
 * declares `require`), passes lint in most configs, and — critically — passes
 * unit tests, because Vitest's transform pipeline supplies a `require` shim.
 * It throws "require is not defined" only when a user runs the shipped code.
 *
 * That combination is why these survive: every automated signal is green.
 *
 * History. The bug first shipped in the CLI's monograph-tools.ts, breaking
 * every default invocation of `monograph_dead_code`. A per-package guard was
 * added there, and it immediately found three more latent instances in the same
 * package. Extending the same scan to the sibling packages then found four
 * more, in code nobody had checked:
 *
 *   - @monomind/mcp   transport/http.ts — `require('crypto')` inside
 *                     timingSafeCompare(), the timing-safe auth token
 *                     comparison. It would throw on every auth check.
 *   - @monomind/monograph  cli/eval-server.ts — `require('express')`, carrying
 *                     an eslint-disable comment that silenced the lint while
 *                     leaving the runtime failure in place.
 *   - @monomind/monograph  pipeline/phases/module-resolution.ts — `require('fs')`
 *   - @monomind/monograph  registry/repo-registry.ts — `require('fs')` in the
 *                     atomic-write path.
 *
 * This test lives at the repo root so there is exactly one scanner and one
 * list of packages, rather than six copies free to drift.
 *
 * Implementation note: a regex approach was tried first in the CLI package and
 * produced FALSE NEGATIVES — independently stripping comments and strings
 * desynchronises on files containing backticks inside quotes, which blanked the
 * very line carrying the bug. The TypeScript AST was unavailable (this repo is
 * on TypeScript 7.x, the native port, whose npm package ships no JS compiler
 * API). Hence the single-pass scanner below, with self-tests pinning it.
 *
 * Allowed: `createRequire(...)` from node:module — the correct ESM escape hatch
 * for a genuinely deferred CJS load — and calls through a binding it returns.
 *
 * 2026-07: extended from .ts/.mts to .mjs. The scan had never covered .mjs, and
 * an eighth instance was sitting in one — `require('zlib')` in the CLI dashboard
 * server (src/ui/server.mjs), inside the cold-tier log-compaction path. Its
 * ReferenceError was swallowed by an enclosing `catch (_) {}`, so compaction had
 * simply never run in production. Notably a runtime test could NOT catch it:
 * under Vitest the require shim described above makes the compaction path work
 * perfectly. This static scan is the only signal that sees it, which is exactly
 * the failure mode this file was written for.
 *
 * .js is deliberately NOT scanned: these packages contain plain-.js files that
 * are genuinely CJS, so the rule does not apply to them uniformly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every ESM package whose sources must stay require-free. */
const PACKAGES = [
  'packages/@monomind/cli',
  'packages/@monomind/mcp',
  'packages/@monomind/memory',
  'packages/@monomind/monograph',
  'packages/@monomind/hooks',
  'packages/@monomind/routing',
  'packages/monofence-ai',
  'packages/@monoes/monobrowse',
  'packages/@monoes/monodesign',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', 'coverage', '.git']);

function collectSources(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    // macOS/exFAT resource forks parse as garbage source.
    if (name.startsWith('._') || SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collectSources(full, out);
    else if (
      (name.endsWith('.ts') || name.endsWith('.mts') || name.endsWith('.mjs')) &&
      !name.endsWith('.d.ts') &&
      !name.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan source left-to-right, tracking whether we are inside a line comment,
 * block comment, quoted string, or template literal, and report the 1-based
 * lines of `require(` calls in real code position. Template `${...}`
 * interpolations return to code state, so a require() inside one is caught.
 */
export function findBareRequireCalls(source: string): number[] {
  const hits: number[] = [];
  let line = 1;
  let i = 0;
  const templateStack: number[] = [];
  let inTemplate = false;
  let braceDepth = 0;
  const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '\n') { line++; i++; continue; }

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '\n') { line++; i++; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }

    if (c === '`') { inTemplate = !inTemplate; i++; continue; }
    if (inTemplate) {
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && next === '{') {
        templateStack.push(braceDepth);
        inTemplate = false;
        braceDepth++;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (c === '{') { braceDepth++; i++; continue; }
    if (c === '}') {
      braceDepth--;
      if (templateStack.length > 0 && braceDepth === templateStack[templateStack.length - 1]) {
        templateStack.pop();
        inTemplate = true;
      }
      i++;
      continue;
    }

    if (isIdentChar(c)) {
      let j = i;
      while (j < source.length && isIdentChar(source[j])) j++;
      if (source.slice(i, j) === 'require') {
        const prev = i > 0 ? source[i - 1] : '';
        if (prev !== '.') {
          let k = j;
          while (k < source.length && /\s/.test(source[k])) k++;
          if (source[k] === '(') hits.push(line);
        }
      }
      i = j;
      continue;
    }

    i++;
  }

  return hits;
}

/** True when the file binds a local `require` from createRequire(). */
function bindsCreateRequire(source: string): boolean {
  return /\brequire\s*=\s*createRequire\s*\(/.test(source);
}

describe('ESM hygiene (monorepo-wide)', () => {
  it('every listed package exists — the list cannot silently rot', () => {
    const missing = PACKAGES.filter((p) => !existsSync(join(REPO_ROOT, p, 'package.json')));
    expect(missing, `PACKAGES lists paths that no longer exist:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every listed package is ESM, so the rule genuinely applies', () => {
    const notEsm: string[] = [];
    for (const pkg of PACKAGES) {
      const pjPath = join(REPO_ROOT, pkg, 'package.json');
      if (!existsSync(pjPath)) continue;
      const pj = JSON.parse(readFileSync(pjPath, 'utf-8'));
      if (pj.type !== 'module') notEsm.push(`${pkg} (type: ${pj.type ?? 'commonjs'})`);
    }
    expect(
      notEsm,
      `These are listed as ESM but are not — either fix package.json or drop them ` +
        `from PACKAGES, because a bare require() is legal in CommonJS:\n${notEsm.join('\n')}`,
    ).toEqual([]);
  });

  it('has no bare CJS require() call in any ESM package source', () => {
    const offenders: string[] = [];

    for (const pkg of PACKAGES) {
      const srcRoot = join(REPO_ROOT, pkg, 'src');
      if (!existsSync(srcRoot)) continue;
      for (const file of collectSources(srcRoot)) {
        const source = readFileSync(file, 'utf-8');
        if (bindsCreateRequire(source)) continue;
        for (const line of findBareRequireCalls(source)) {
          offenders.push(`${relative(REPO_ROOT, file)}:${line}`);
        }
      }
    }

    expect(
      offenders,
      `Bare CJS require() found in an ESM package. These throw ` +
        `"require is not defined" in the built output even though typecheck, ` +
        `lint and tests all pass — Vitest supplies a require shim, so no ` +
        `automated signal catches them except this one. Use a static import, ` +
        `or createRequire(import.meta.url) when a CJS module genuinely must be ` +
        `loaded at runtime.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  // --- self-tests: prove the scanner fires, and only where it should -------

  it('detects a bare require() (the shape that actually shipped)', () => {
    const sample = [
      'export function f() {',
      "  const { readdirSync } = require('fs') as typeof import('fs');",
      '  return readdirSync;',
      '}',
    ].join('\n');
    expect(findBareRequireCalls(sample)).toEqual([2]);
  });

  it('detects the crypto shape found in @monomind/mcp', () => {
    const sample = [
      'class T {',
      '  cmp(a: string, b: string) {',
      "    const crypto = require('crypto');",
      '    return crypto.timingSafeEqual(a, b);',
      '  }',
      '}',
    ].join('\n');
    expect(findBareRequireCalls(sample)).toEqual([3]);
  });

  it('ignores require( inside single-quoted strings', () => {
    expect(findBareRequireCalls("export const g = 'const x = require(\\'fs\\');';")).toEqual([]);
  });

  it('ignores require( inside template literals holding stray quotes', () => {
    // The shape that defeated the regex implementation.
    const sample = [
      'export const sql = `SELECT * FROM t',
      "  WHERE note = 'it\\'s fine' AND src = 'require(x)'`;",
      'export const ok = 1;',
    ].join('\n');
    expect(findBareRequireCalls(sample)).toEqual([]);
  });

  it('ignores require( inside comments', () => {
    const sample = [
      '// const a = require("fs");',
      '/* const b = require("os"); */',
      'export const ok = 1;',
    ].join('\n');
    expect(findBareRequireCalls(sample)).toEqual([]);
  });

  it('still detects a require() inside a template interpolation', () => {
    expect(findBareRequireCalls('export const s = `v: ${require("fs").x}`;')).toEqual([1]);
  });

  it('does not flag property-access .require(', () => {
    expect(findBareRequireCalls('export const m = (import.meta as any).require("fs");')).toEqual([]);
  });

  it('does not flag createRequire itself', () => {
    const sample = [
      "import { createRequire } from 'node:module';",
      'const req = createRequire(import.meta.url);',
      "export const mod = req('./thing.cjs');",
    ].join('\n');
    expect(findBareRequireCalls(sample)).toEqual([]);
  });
});
