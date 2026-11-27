import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import group from './modules/_group.js';
import _ from './modules/index-all.js';

test('group takes an options object', () => {
  const split = group((result, value, pass) => result[pass ? 0 : 1].push(value), {
    partition: true,
  });
  assert.deepEqual(
    split([1, 2, 3, 4], (x) => x > 2),
    [
      [3, 4],
      [1, 2],
    ],
  );
  const byParity = group((result, value, key) => (result[key] ??= []).push(value));
  assert.deepEqual(
    byParity([1, 2, 3], (x) => x % 2),
    { 1: [1, 3], 0: [2] },
  );
  const explicitOff = group((result, value, key) => (result[key] = value), { partition: false });
  assert.deepEqual(explicitOff(['a', 'bb'], 'length'), { 1: 'a', 2: 'bb' });
});

test('a bare boolean no longer selects partition mode', () => {
  const g = group((result, value, pass) => (result[pass ? 0 : 1] ??= []).push(value), true);
  assert.equal(Array.isArray(g([1, 2], () => true)), false);
});

test('the public grouping functions are unchanged', () => {
  assert.deepEqual(_.groupBy([1.1, 2.3, 1.9], Math.floor), { 1: [1.1, 1.9], 2: [2.3] });
  assert.deepEqual(_.countBy(['a', 'bb', 'c'], 'length'), { 1: 2, 2: 1 });
  assert.deepEqual(_.indexBy([{ id: 7 }, { id: 9 }], 'id'), { 7: { id: 7 }, 9: { id: 9 } });
  assert.deepEqual(
    _.partition([1, 2, 3, 4, 5], (x) => x % 2),
    [
      [1, 3, 5],
      [2, 4],
    ],
  );
  assert.deepEqual(
    _.partition({ a: 1, b: 2 }, (x) => x > 1),
    [[2], [1]],
  );
});

test('partition.js passes the options object, the others pass nothing', () => {
  assert.match(readFileSync('modules/partition.js', 'utf8'), /\{\s*partition:\s*true\s*\}\s*\)/);
  for (const f of ['groupBy', 'countBy', 'indexBy'])
    assert.doesNotMatch(readFileSync(`modules/${f}.js`, 'utf8'), /\}\s*,\s*(true|false)\s*\)/, f);
});
