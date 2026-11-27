import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const braces = require('braces');
const micromatch = require('micromatch');

const throwsMax = (fn) =>
  assert.throws(
    fn,
    (e) => e instanceof RangeError && /maxItems/.test(e.message),
    'expected a RangeError naming maxItems',
  );

test('expansion within the limit is unchanged', () => {
  assert.equal(braces.expand('{1..5}{a,b}', { maxItems: 10 }).length, 10);
  assert.deepEqual(braces('{a,b}{c,d}', { expand: true, maxItems: 4 }), ['ac', 'ad', 'bc', 'bd']);
});

test('exceeding the limit throws a RangeError that names the option', () => {
  throwsMax(() => braces.expand('{1..5}{a,b}', { maxItems: 9 }));
  throwsMax(() => braces('{a,b}{c,d}', { expand: true, maxItems: 3 }));
  throwsMax(() => braces.expand('{1..50}', { maxItems: 10 }));
});

test('the limit applies per pattern when an array is given', () => {
  assert.deepEqual(braces(['{a,b}', '{c,d}'], { expand: true, maxItems: 2 }), ['a', 'b', 'c', 'd']);
  throwsMax(() => braces(['{a,b}', '{c,d,e}'], { expand: true, maxItems: 2 }));
});

test('micromatch.braceExpand and micromatch.braces with expand honour it', () => {
  assert.deepEqual(micromatch.braceExpand('{a,b,c}', { maxItems: 3 }), ['a', 'b', 'c']);
  throwsMax(() => micromatch.braceExpand('{a,b,c}', { maxItems: 2 }));
  throwsMax(() => micromatch.braces('{a,b,c}', { expand: true, maxItems: 2 }));
});

test('compile mode and the default are not limited', () => {
  assert.deepEqual(braces('{a,b,c}', { maxItems: 2 }), ['(a|b|c)']);
  assert.equal(braces.expand('{1..500}').length, 500);
  assert.equal(braces.expand('{1..500}', { maxItems: null }).length, 500);
  assert.equal(braces.expand('{1..500}', { maxItems: undefined }).length, 500);
});

test('an invalid brace set that expands to itself is not counted against the limit', () => {
  assert.deepEqual(braces.expand('a{b}c', { maxItems: 1 }), ['a{b}c']);
});
