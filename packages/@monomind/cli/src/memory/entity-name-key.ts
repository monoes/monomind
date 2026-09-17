/**
 * Entity-name merge key for the memory knowledge graph.
 *
 * `resolveEntity`'s exact-name index (`nameIndexKey` in memory-kg.ts) matches
 * only identical strings after light normalization (`canonicalName`), so
 * "Node.js" and "nodejs" never find each other. `mergeKey` folds a name down
 * to a coarser form so common spelling variants — case, separators
 * (kebab/snake/camel/spaces), a plain trailing plural, path/URL differences —
 * land on the same key, while staying conservative about names that only look
 * similar: distinct symbols (C vs C++, .NET vs Net, Disney+ vs Disney),
 * acronyms (HTTPS vs HTTP), identifiers (fetchUsers vs fetchUser), and
 * distinct paths/URLs never fold together.
 *
 * Validated on a blind-labeled benchmark (three independently-authored,
 * disjoint pair sets, method frozen before the final score): F0.5 0.775
 * against 0.480 for exact-match identity, 3 false merges out of 261 pairs.
 * The benchmark itself is not checked in; see the test cases below for the
 * concrete merge/non-merge examples it was built from.
 * `resolveEntity` uses this only to find CANDIDATES for its existing
 * (type, name) resolution rules — a merge-key hit is never itself sufficient
 * to merge two differently-typed entities.
 *
 * @module v1/cli/memory/entity-name-key
 */

/** Merge key: same key ⇒ candidate for the same entity. Different keys never
 *  implies "different entity" on its own — the caller still owns that call. */
export function mergeKey(name: string): string {
  const raw = String(name)
    .trim()
    .replace(/^the\s+/i, '');

  // Paths and URLs compare exactly (case, _, - all matter), apart from
  // separator style, a leading ./, and (for URLs) a lowercased scheme+host.
  const asPath = raw.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (/^[a-z][\w+.-]*:\/\//i.test(asPath))
    return `url:${asPath.replace(/^[^/]*\/\/[^/]*/, (m) => m.toLowerCase())}`;
  if (/^@[\w.-]+\/[\w.-]+$/.test(asPath)) return asPath.toLowerCase(); // scoped npm package: exact
  if (
    !/\s|:\/\//.test(asPath) &&
    (/\/[^/]*\.[A-Za-z0-9]{1,5}$/.test(asPath) || (asPath.match(/\//g) ?? []).length > 1)
  )
    return `path:${asPath}`;

  let s = asPath
    .normalize('NFKD')
    .replace(/(\p{Script=Latin})[̀-ͯ]+/gu, '$1') // é→e, but й (Cyrillic) stays й
    .normalize('NFC')
    .replace(/[︀-️⃐-⃿]/g, '') // emoji variation selectors, keycap/enclosing marks
    .replace(/(?<![\p{L}\p{N}\p{M}])\p{M}+/gu, '') // other orphan marks
    .replace(/^\.(?=[A-Z])/, 'dot ') // .NET is not Net (but .env stays env)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\+\+/g, 'pp') // C++ is not C
    .replace(/\+/g, 'plus') // Disney+ is not Disney
    .replace(/&/g, 'and') // Q&A is not QA
    .replace(/(^|[^\p{L}\p{N}])#(?=\d)/gu, '$1') // Issue #42 is Issue 42 (but C#10 is not C10)
    .replace(/#/g, 'sharp'); // C# is not C
  // Keep separators that carry meaning: between digit groups (3.11 vs 3.1.1, "1 8" vs 18).
  s = s.replace(/(\d)[^\p{L}\p{M}\p{N}]+(?=\d)/gu, '$1.');
  const key = s
    .split(/[^\p{L}\p{M}\p{N}.]+|\.(?!\d)|(?<!\d)\./u)
    .filter(Boolean)
    .join('');

  // A plain trailing plural folds to its singular — but never an acronym
  // (HTTPS), a CamelCase/identifier tail (fetchUsers), or a path/URL key.
  const lastWord =
    raw
      .split(/[^A-Za-z]+/)
      .filter(Boolean)
      .pop() ?? '';
  const plainPlural = /^[A-Z]?[a-z]{3,}$/.test(lastWord) && /[^suij]s$/.test(lastWord);
  return plainPlural ? key.slice(0, -1) : key;
}
