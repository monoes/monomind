import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const JSON5 = require('./lib');

const value = { a: 1, b: [1, 2], c: { d: 'x' }, e: [], f: {} };

test('default output keeps the trailing commas', () => {
  assert.equal(
    JSON5.stringify(value, null, 2),
    "{\n  a: 1,\n  b: [\n    1,\n    2,\n  ],\n  c: {\n    d: 'x',\n  },\n  e: [],\n  f: {},\n}",
  );
});

test('trailingComma: false removes them from objects and arrays at every level', () => {
  const out = JSON5.stringify(value, { space: 2, trailingComma: false });
  assert.equal(
    out,
    "{\n  a: 1,\n  b: [\n    1,\n    2\n  ],\n  c: {\n    d: 'x'\n  },\n  e: [],\n  f: {}\n}",
  );
  assert.deepEqual(JSON5.parse(out), value);
});

test('it works together with replacer and quote in the object form', () => {
  const out = JSON5.stringify(
    { k: 'v', skip: 1 },
    {
      space: '\t',
      trailingComma: false,
      quote: '"',
      replacer: (key, v) => (key === 'skip' ? undefined : v),
    },
  );
  assert.equal(out, '{\n\tk: "v"\n}');
  assert.equal(
    JSON5.stringify({ a: [1] }, { replacer: ['a'], space: 1, trailingComma: false }),
    '{\n a: [\n  1\n ]\n}',
  );
});

test('trailingComma: true is the same as the default and compact output is never affected', () => {
  assert.equal(
    JSON5.stringify(value, { space: 2, trailingComma: true }),
    JSON5.stringify(value, null, 2),
  );
  assert.equal(
    JSON5.stringify(value, { trailingComma: false }),
    "{a:1,b:[1,2],c:{d:'x'},e:[],f:{}}",
  );
  assert.equal(JSON5.stringify(value), "{a:1,b:[1,2],c:{d:'x'},e:[],f:{}}");
  assert.equal(
    JSON5.stringify([1, [2]], { space: 1, trailingComma: false }),
    '[\n 1,\n [\n  2\n ]\n]',
  );
});

test('the old (value, replacer, space) signature still works', () => {
  assert.equal(JSON5.stringify({ a: 1 }, null, 1), '{\n a: 1,\n}');
  assert.equal(JSON5.stringify({ a: 1, b: 2 }, ['a'], 1), '{\n a: 1,\n}');
});
