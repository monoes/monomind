import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import * as R from './source/index.js';

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

test('the combinator is exported as fanIn only', () => {
  assert.equal(typeof R.fanIn, 'function');
  assert.equal(R.converge, undefined);
  assert.equal(R.fanIn(R.divide, [R.sum, R.length])([1, 2, 3, 4, 5, 6, 7]), 4);
  assert.equal(R.fanIn(R.concat, [R.toUpper, R.toLower])('Tomato'), 'TOMATOtomato');
  assert.equal(R.fanIn.length, 2);
});

test('curried arity and placeholders still work', () => {
  const add3 = (a, b, c) => a + b + c;
  const f = R.fanIn(add3, [(x, y) => x * y, (x, y) => x + y, R.subtract]);
  assert.equal(f.length, 2);
  assert.equal(f(3, 4), 12 + 7 + -1);
  assert.equal(R.fanIn(R.__, [R.sum])(R.identity)([1, 2]), 3);
  assert.equal(R.fanIn(R.add)([R.identity, R.identity])(2), 4);
});

test('its dependents still work: juxt, applySpec, call, useWith', () => {
  assert.deepEqual(R.juxt([Math.min, Math.max, R.add])(3, 4), [3, 4, 7]);
  assert.deepEqual(R.applySpec({ sum: R.add, nested: { mul: R.multiply } })(2, 3), { sum: 5, nested: { mul: 6 } });
  assert.equal(R.call(R.fanIn(R.concat, [R.toUpper, R.toLower]), 'Ab'), 'ABab');
  assert.equal(R.useWith(Math.pow, [R.identity, R.identity])(3, 4), 81);
});

test('the module file moved and the old name is gone from every source file', () => {
  assert.equal(existsSync('source/fanIn.js'), true);
  assert.equal(existsSync('source/converge.js'), false);
  const left = walk('source').filter((f) => /\bconverge\b/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(left, []);
});
