/**
 * mergeKey: ported from the blind-benchmark's validated M1p method
 * (surface key + plain-plural fold). See entity-name-key.ts for the
 * methodology and measured F0.5.
 */

import { describe, expect, it } from 'vitest';
import { mergeKey } from '../memory/entity-name-key.js';

const same = (a: string, b: string) => mergeKey(a) === mergeKey(b);

describe('mergeKey: names that should merge', () => {
  it.each([
    ['Node.js', 'nodejs'],
    ['Node.js', 'node js'],
    ['memory-bridge', 'memoryBridge'],
    ['HTTP/2', 'HTTP 2'],
    ['the auth service', 'auth service'],
    ['Next.js', 'NextJS'],
    ['hooks', 'hook'],
    ['React Hook', 'React Hooks'],
    ['API key', 'API keys'],
    ['Redis', 'redis'],
    ['Kubernetes', 'kubernetes'],
    ['Python 3.11', 'Python 3.11'],
    ['v1.8', 'v1.8'],
    ['./src/utils/logger.ts', 'src/utils/logger.ts'],
    ['src\\utils\\logger.ts', 'src/utils/logger.ts'],
    ['The .NET runtime', '.NET runtime'],
    ['Issue #42', 'Issue 42'],
    ['https://GitHub.com/Foo', 'https://github.com/Foo'],
    ['Zürich', 'Zurich'],
    ['A/B/C Testing', 'A B C testing'],
  ])('%s == %s', (a, b) => {
    expect(same(a, b)).toBe(true);
  });
});

describe('mergeKey: names that must NOT merge', () => {
  it.each([
    ['C++', 'C'],
    ['C#', 'C'],
    ['C#10', 'C10'],
    ['.NET', 'Net'],
    ['HTTPS', 'HTTP'],
    ['fetchUsers', 'fetchUser'],
    ['@babel/core', 'babel-core'],
    ['Disney+', 'Disney'],
    ['Q&A', 'QA'],
    ['.env', 'dotenv'],
    ['Python 3.11', 'Python 3.1.1'],
    ['v1.10', 'v11.0'],
    ['src/a/b.ts', 'src/ab.ts'],
    ['src/Foo.ts', 'src/foo.ts'],
    ['src/foo_bar.ts', 'src/foobar.ts'],
    ['packages/foo/bars', 'packages/foo/bar'],
    ['GPT 4 32k', 'GPT-43 2k'],
    ['https://a.com/x/y', 'https://a.com/xy'],
    ['https://github.com/foo/bar-baz', 'https://github.com/foobar/baz'],
    ['Москва', 'Москвы'], // Cyrillic: accent-strip must not touch non-Latin letters
    ['C', 'C++'],
  ])('%s != %s', (a, b) => {
    expect(same(a, b)).toBe(false);
  });
});

describe('mergeKey: known accepted trade-off (documented, not fixed)', () => {
  it('folds a proper noun that happens to look like a plural', () => {
    // "Windows"/"Window" merging is a known false-positive risk from the plain-
    // plural rule; the (type, name) rule in resolveEntity is the real guard
    // against a wrong merge here, not mergeKey alone.
    expect(same('Windows', 'Window')).toBe(true);
  });
});

describe('mergeKey: never empty for a non-empty input', () => {
  it.each(['Node.js', 'C++', '.NET', 'Москва', '東京'])('%s has a non-empty key', (name) => {
    expect(mergeKey(name).length).toBeGreaterThan(0);
  });
});
