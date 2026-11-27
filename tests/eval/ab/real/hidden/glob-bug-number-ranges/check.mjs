import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const braces = require('braces');
const fill = require('fill-range');
const toRegexRange = require('to-regex-range');
const micromatch = require('micromatch');

const matches = (source, from, to, extra = 30) => {
  const re = new RegExp('^(?:' + source + ')$');
  const wrong = [];
  for (let i = Math.max(0, from - 5); i <= to + extra; i++) {
    if (re.test(String(i)) !== (i >= from && i <= to)) wrong.push(i);
  }
  return wrong;
};

test('to-regex-range matches exactly the numbers in the range', () => {
  for (const [a, b] of [
    [1, 20],
    [5, 123],
    [1, 100],
    [10, 99],
    [0, 9],
    [45, 1005],
    [7, 7],
  ])
    assert.deepEqual(matches(toRegexRange(a, b), a, b), [], `range ${a}..${b}`);
});

test('fill-range with toRegex agrees', () => {
  assert.deepEqual(matches(fill(1, 20, { toRegex: true }), 1, 20), []);
  assert.deepEqual(matches(fill('3', '250', { toRegex: true }), 3, 250), []);
});

test('braces numeric ranges compile to the right regex', () => {
  assert.deepEqual(braces('{1..20}', { toRegex: true }), ['([1-9]|1[0-9]|20)']);
  assert.deepEqual(matches(braces('{1..120}', { toRegex: true })[0], 1, 120), []);
  assert.deepEqual(braces('a{1..3}'), ['a([1-3])']);
});

test('micromatch exposes the same results', () => {
  assert.deepEqual(micromatch.braces('{1..20}', { toRegex: true }), ['([1-9]|1[0-9]|20)']);
  assert.deepEqual(micromatch.braceExpand('{8..12}'), ['8', '9', '10', '11', '12']);
});

test('padded and descending ranges still work', () => {
  assert.deepEqual(braces.expand('{01..03}'), ['01', '02', '03']);
  assert.deepEqual(braces.expand('{5..1..2}'), ['5', '3', '1']);
  assert.deepEqual(matches(toRegexRange(1, 3), 1, 3), []);
});
