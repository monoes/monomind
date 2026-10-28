import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginate } from './src/paginate.mjs';

test('an empty list has empty pages', () => {
  assert.deepEqual(paginate([], 1, 2), []);
});
