import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from './src/slugify.mjs';

test('strips diacritics', () => {
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
});

test('drops punctuation and collapses separators', () => {
  assert.equal(slugify('  Hello,   World!! '), 'hello-world');
  assert.equal(slugify('a -- b'), 'a-b');
});

test('keeps digits', () => {
  assert.equal(slugify('Top 10 Tips'), 'top-10-tips');
});

test('empty input gives an empty slug', () => {
  assert.equal(slugify('  !!  '), '');
});
