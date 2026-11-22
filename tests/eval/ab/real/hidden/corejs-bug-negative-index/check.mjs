import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const P = 'packages/core-js';
const toAbsoluteIndex = require(`./${P}/internals/to-absolute-index`);
const { indexOf, includes } = require(`./${P}/internals/array-includes`);

test('a negative index counts from the end and never goes below zero', () => {
  assert.equal(toAbsoluteIndex(-1, 5), 4);
  assert.equal(toAbsoluteIndex(-5, 5), 0);
  assert.equal(toAbsoluteIndex(-6, 5), 0);
  assert.equal(toAbsoluteIndex(-100, 5), 0);
  assert.equal(toAbsoluteIndex(-Infinity, 5), 0);
  assert.equal(toAbsoluteIndex(-3, 0), 0);
});

test('non-negative indexes clamp to the length', () => {
  assert.equal(toAbsoluteIndex(0, 5), 0);
  assert.equal(toAbsoluteIndex(3, 5), 3);
  assert.equal(toAbsoluteIndex(5, 5), 5);
  assert.equal(toAbsoluteIndex(9, 5), 5);
  assert.equal(toAbsoluteIndex(Infinity, 5), 5);
  assert.equal(toAbsoluteIndex(undefined, 5), 0);
  assert.equal(toAbsoluteIndex('2', 5), 2);
});

test('indexOf and includes honour a fromIndex that reaches before the start', () => {
  const list = ['a', 'b', 'c'];
  assert.equal(indexOf(list, 'a', -10), 0);
  assert.equal(indexOf(list, 'a', -3), 0);
  assert.equal(indexOf(list, 'a', -2), -1);
  assert.equal(indexOf(list, 'c', -1), 2);
  assert.equal(includes(list, 'a', -10), true);
  assert.equal(includes(list, 'a', -2), false);
  assert.equal(includes([NaN, 1], NaN, -100), true);
});

test('the methods built on the helper see the same clamping', () => {
  const { fill } = { fill: require(`./${P}/internals/array-fill`) };
  assert.deepEqual(fill.call([1, 2, 3], 0, -10), [0, 0, 0]);
  const copyWithin = require(`./${P}/internals/array-copy-within`);
  assert.deepEqual(copyWithin.call([1, 2, 3, 4, 5], -100, 3), [4, 5, 3, 4, 5]);
});
