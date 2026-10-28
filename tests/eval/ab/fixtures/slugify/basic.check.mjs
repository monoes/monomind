import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from './src/slugify.mjs';

test('lowercases and joins words', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});
