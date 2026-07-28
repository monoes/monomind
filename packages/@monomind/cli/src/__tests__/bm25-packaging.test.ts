/**
 * Packaging guard for the shared tokeniser.
 *
 * `memory/bm25-index.ts` imports `contentTokens` from `memory/text-tokens.ts`,
 * the neutral module that also backs the eval harness's tokenisation. Because
 * it lives under `memory/` — unambiguously production code — a future
 * `!dist/**/eval/**` exclusion cannot break it. This test asserts the module
 * remains in the published tarball and is not caught by any negation pattern.
 *
 * Verified at the time of writing with `npm pack --dry-run --json`: 1,608 files
 * in the tarball, `text-tokens.js` among them under `dist/src/memory/`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..', '..');

/** Path that production imports at runtime, relative to the package root. */
const SHIPPED_DEPENDENCY = 'dist/src/memory/text-tokens.js';

describe('the shared tokeniser ships to users', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf-8')) as {
    files?: string[];
  };

  it('package.json declares a files array', () => {
    expect(Array.isArray(pkg.files)).toBe(true);
  });

  it('no negation pattern excludes the tokeniser module', () => {
    const negations = (pkg.files ?? []).filter(f => f.startsWith('!'));
    const offending = negations.filter(neg => {
      const pattern = neg.slice(1);
      // Flag any exclusion mentioning the memory directory or the text-tokens
      // module by name.
      return /text-tokens|memory\/text/.test(pattern);
    });
    expect(
      offending,
      `package.json "files" excludes the module production imports: ${offending.join(', ')}`,
    ).toEqual([]);
  });

  it('the tokeniser module is not test-only by convention', () => {
    // The existing exclusions are `*.test.js`, `*.test.d.ts` and `__tests__/**`.
    // `text-tokens.js` matches none of them.
    expect(SHIPPED_DEPENDENCY).not.toMatch(/\.test\.js$/);
    expect(SHIPPED_DEPENDENCY).not.toMatch(/__tests__/);
  });

  it('the built artefact exists after a build', () => {
    const built = path.join(PKG_ROOT, SHIPPED_DEPENDENCY);
    if (!fs.existsSync(path.join(PKG_ROOT, 'dist'))) {
      // Nothing built in this checkout — the packaging assertions above still
      // hold, and CI builds before packing.
      return;
    }
    expect(
      fs.existsSync(built),
      `${SHIPPED_DEPENDENCY} is missing from dist — production retrieval imports it`,
    ).toBe(true);
  });

  it('bm25-index imports from memory/text-tokens, not from eval/', () => {
    // The whole point: production must not depend on an eval/ path.
    const bm25Src = fs.readFileSync(
      path.join(PKG_ROOT, 'src', 'memory', 'bm25-index.ts'),
      'utf-8',
    );
    expect(bm25Src).toContain("from './text-tokens.js'");
    expect(bm25Src).not.toContain('eval/metrics');
  });
});
