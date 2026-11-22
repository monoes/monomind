import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const util = require('./lib/util');
const JSON5 = require('./lib');

test('util exports the new helper names and not the old ones', () => {
  assert.equal(typeof util.isIdentifierStart, 'function');
  assert.equal(typeof util.isIdentifierPart, 'function');
  assert.equal('isIdStartChar' in util, false);
  assert.equal('isIdContinueChar' in util, false);
  assert.equal(util.isIdentifierStart('a') && util.isIdentifierStart('$') && util.isIdentifierStart('_'), true);
  assert.equal(util.isIdentifierStart('1'), false);
  assert.equal(util.isIdentifierPart('1'), true);
  assert.equal(util.isIdentifierPart('-'), false);
  assert.equal(util.isIdentifierPart('‌'), true);
  assert.equal(util.isIdentifierStart('é'), true);
});

test('no library file still uses the old names', () => {
  for (const f of readdirSync('lib').filter((n) => n.endsWith('.js')))
    assert.doesNotMatch(readFileSync(`lib/${f}`, 'utf8'), /isIdStartChar|isIdContinueChar/, f);
});

test('the parser still reads unquoted identifier keys, including unicode and escapes', () => {
  assert.deepEqual(JSON5.parse('{ $a_1: 1, ünï: 2, \\u0061b: 3, _x9: 4 }'), { $a_1: 1, ünï: 2, ab: 3, _x9: 4 });
  assert.throws(() => JSON5.parse('{ 1a: 1 }'), SyntaxError);
  assert.throws(() => JSON5.parse('{ a-b: 1 }'), SyntaxError);
  assert.equal(JSON5.parse('Infinity'), Infinity);
  assert.equal(JSON5.parse('-NaN') !== JSON5.parse('-NaN'), true);
});

test('the stringifier still decides key quoting with the same rule', () => {
  assert.equal(JSON5.stringify({ a1: 1, $x: 2, _y: 3, ünï: 4 }), "{a1:1,$x:2,_y:3,ünï:4}");
  assert.equal(JSON5.stringify({ '1a': 1, 'a-b': 2, '': 3 }), "{'1a':1,'a-b':2,'':3}");
});
