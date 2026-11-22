import assert from 'node:assert/strict';
import { test } from 'node:test';
import _ from './modules/index-all.js';

const arr = [1, 2, 3, 2, 1];

test('indexOf with a negative fromIndex counts from the end', () => {
  assert.equal(_.indexOf(arr, 2, -2), 3);
  assert.equal(_.indexOf(arr, 1, -1), 4);
  assert.equal(_.indexOf(arr, 3, -2), -1);
  assert.equal(_.indexOf(arr, 2, -100), 1);
});

test('contains/includes with a negative fromIndex agree', () => {
  assert.equal(_.contains(arr, 3, -2), false);
  assert.equal(_.contains(arr, 3, -3), true);
  assert.equal(_.includes(arr, 3, -2), false);
});

test('non-negative fromIndex and no fromIndex are unchanged', () => {
  assert.equal(_.indexOf(arr, 2), 1);
  assert.equal(_.indexOf(arr, 2, 2), 3);
  assert.equal(_.indexOf(arr, 1, 1), 4);
  assert.equal(_.indexOf(arr, 9), -1);
  assert.equal(_.indexOf([NaN], NaN), 0);
  assert.equal(_.indexOf([1, NaN, 3, NaN], NaN, 2), 3);
});

test('lastIndexOf and the sorted fast path are unchanged', () => {
  assert.equal(_.lastIndexOf(arr, 2), 3);
  assert.equal(_.lastIndexOf(arr, 2, 2), 1);
  assert.equal(_.lastIndexOf(arr, 1, -2), 0);
  assert.equal(_.indexOf([1, 2, 3, 4], 3, true), 2);
});
