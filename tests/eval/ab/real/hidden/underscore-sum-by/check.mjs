import assert from 'node:assert/strict';
import { test } from 'node:test';
import _, { sumBy as namedFromAll } from './modules/index-all.js';
import { sumBy as namedFromIndex } from './modules/index.js';
import sumByModule from './modules/sumBy.js';

test('exported as default module, named export and _ member', () => {
  assert.equal(typeof sumByModule, 'function');
  assert.equal(namedFromIndex, sumByModule);
  assert.equal(namedFromAll, sumByModule);
  assert.equal(_.sumBy, sumByModule);
});

test('sums with and without an iteratee', () => {
  assert.equal(_.sumBy([1, 2, 3]), 6);
  assert.equal(_.sumBy([1, 2, 3], (x) => x * 2), 12);
  assert.equal(_.sumBy([{ a: 1 }, { a: 2 }, { a: 4 }], 'a'), 7);
  assert.equal(_.sumBy([{ a: { b: 2 } }, { a: { b: 5 } }], ['a', 'b']), 7);
  assert.equal(_.sumBy([{ k: 1, n: 5 }, { k: 2, n: 6 }, { k: 1, n: 7 }], { k: 1 }), 2);
});

test('works on objects and passes (value, key, collection) to the iteratee', () => {
  assert.equal(_.sumBy({ x: 3, y: 4 }), 7);
  const seen = [];
  _.sumBy({ x: 3, y: 4 }, (v, k, o) => (seen.push([v, k, o === undefined]), v));
  assert.deepEqual(seen, [[3, 'x', false], [4, 'y', false]]);
  assert.equal(_.sumBy([1, 2, 3], function (x) { return x * this.m; }, { m: 10 }), 60);
});

test('empty and nullish collections sum to zero', () => {
  assert.equal(_.sumBy([]), 0);
  assert.equal(_.sumBy({}), 0);
  assert.equal(_.sumBy(null), 0);
  assert.equal(_.sumBy(undefined, 'a'), 0);
});

test('chaining and OOP style are supported', () => {
  assert.equal(_([1, 2, 3]).sumBy((x) => x + 1), 9);
  assert.equal(_.chain([{ a: 1 }, { a: 2 }]).sumBy('a').value(), 3);
});

test('neighbouring functions are untouched', () => {
  assert.deepEqual(_.groupBy([1, 2, 3], (x) => x % 2), { 1: [1, 3], 0: [2] });
  assert.equal(_.max([3, 9, 2]), 9);
});
