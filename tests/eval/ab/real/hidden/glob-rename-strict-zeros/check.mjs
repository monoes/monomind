import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const braces = require('braces');
const fill = require('fill-range');
const toRegexRange = require('to-regex-range');
const micromatch = require('micromatch');

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : [],
  );

test('to-regex-range honours keepZeros and ignores strictZeros', () => {
  assert.equal(toRegexRange('01', '10', { keepZeros: true }), '(?:0[1-9]|10)');
  assert.equal(toRegexRange('01', '10'), '(?:0?[1-9]|10)');
  assert.equal(toRegexRange('01', '10', { keepZeros: false }), '(?:0?[1-9]|10)');
  assert.equal(toRegexRange('01', '10', { strictZeros: true }), '(?:0?[1-9]|10)');
  assert.equal(toRegexRange('01', '10', { relaxZeros: false }), '(?:0[1-9]|10)');
});

test('fill-range passes the option through to to-regex-range', () => {
  assert.equal(fill('01', '10', { toRegex: true, keepZeros: true }), '0[1-9]|10');
  assert.equal(fill('01', '10', { toRegex: true }), '0?[1-9]|10');
  assert.equal(fill('01', '10', { toRegex: true, strictZeros: true }), '0?[1-9]|10');
});

test('braces compiles padded ranges with the strict behaviour by default', () => {
  assert.deepEqual(braces('{01..03}', { toRegex: true }), ['(0[1-3])']);
  assert.deepEqual(braces('a{05..12}b', { toRegex: true }), ['a(0[5-9]|1[0-2])b']);
  const re = new RegExp('^' + braces('{01..10}', { toRegex: true })[0] + '$');
  assert.equal(re.test('05'), true);
  assert.equal(re.test('5'), false);
});

test('expansion and micromatch are unaffected', () => {
  assert.deepEqual(braces.expand('{01..03}'), ['01', '02', '03']);
  assert.deepEqual(micromatch.braces('a{1..3}', { expand: true }), ['a1', 'a2', 'a3']);
  assert.deepEqual(micromatch(['a1', 'a2', 'b1'], 'a*'), ['a1', 'a2']);
});

test('no package still mentions strictZeros', () => {
  for (const f of walk('packages')) assert.doesNotMatch(readFileSync(f, 'utf8'), /strictZeros/, f);
});
