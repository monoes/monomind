/**
 * better-sqlite3 is an OPTIONAL dependency. Importing this package must not
 * require it.
 *
 * The regression: sqlite-backend.ts carried a static top-level
 * `import Database from 'better-sqlite3'`, and index.ts re-exports
 * SQLiteBackend, so `import '@monoes/memory'` threw ERR_MODULE_NOT_FOUND for
 * anyone who did not have the native module. That made the entire package —
 * including the pure-WASM sql.js path — unusable in exactly the situation the
 * fallback exists for: Windows and anywhere else node-gyp cannot build.
 *
 * No existing test caught it, and none easily could: better-sqlite3 is always
 * installed in this repo, so every in-process import succeeds. The bug is only
 * observable from a consumer install without the optional dependency. So this
 * pins the invariant at the source level instead — the import must be dynamic,
 * reached only when the native backend is actually opened.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const OPTIONAL_NATIVE = 'better-sqlite3';

/** Static ESM import or CJS require of the module — i.e. load-bearing at import time. */
const STATIC_IMPORT = new RegExp(
  String.raw`(?:^|\n)\s*import\s[^;]*?from\s*['"]${OPTIONAL_NATIVE}['"]` +
    String.raw`|(?:^|\n)\s*import\s*['"]${OPTIONAL_NATIVE}['"]` +
    String.raw`|require\(\s*['"]${OPTIONAL_NATIVE}['"]\s*\)`,
);

function sourceFiles(): string[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.includes('.test.'))
    .map((f) => join(SRC, f));
}

describe('optional native dependency stays optional', () => {
  it('no source file statically imports better-sqlite3', () => {
    const offenders = sourceFiles().filter((file) => {
      const source = readFileSync(file, 'utf-8');
      // `import type` is erased at compile time and costs nothing at runtime.
      const withoutTypeImports = source.replace(/(?:^|\n)\s*import\s+type\s[^;]*;/g, '');
      return STATIC_IMPORT.test(withoutTypeImports);
    });

    expect(
      offenders,
      `These files load ${OPTIONAL_NATIVE} at import time, so importing the package fails ` +
        'wherever the native module is unavailable — which is the whole reason the sql.js ' +
        'fallback exists. Use `await import()` inside the function that needs it.',
    ).toEqual([]);
  });

  it('the SQLite backend still reaches better-sqlite3 dynamically', () => {
    // Guards the other direction: satisfying the rule above by dropping the
    // dependency entirely would leave the native backend broken.
    const source = readFileSync(join(SRC, 'sqlite-backend.ts'), 'utf-8');
    expect(source).toMatch(/await import\(\s*['"]better-sqlite3['"]\s*\)/);
  });
});
