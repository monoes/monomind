import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginate } from './src/paginate.mjs';

const items = [1, 2, 3, 4, 5];

test('every page holds `size` items', () => {
  assert.deepEqual(paginate(items, 1, 2), [1, 2]);
  assert.deepEqual(paginate(items, 2, 2), [3, 4]);
});

test('last page holds the remainder', () => {
  assert.deepEqual(paginate(items, 3, 2), [5]);
});

test('a page past the end is empty', () => {
  assert.deepEqual(paginate(items, 4, 2), []);
});
