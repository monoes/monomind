import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const yaml = require('./index.js');

test('!!regexp scalars load as RegExp objects (flags optional)', () => {
  const doc = yaml.load('plain: !!regexp /ab+c/\nflagged: !!regexp /x.y/gi\n');
  assert.ok(doc.plain instanceof RegExp);
  assert.equal(doc.plain.source, 'ab+c');
  assert.equal(doc.plain.flags, '');
  assert.equal(doc.flagged.source, 'x.y');
  assert.equal(doc.flagged.flags, 'gi');
});

test('slashes inside the pattern survive', () => {
  const doc = yaml.load('p: !!regexp /a\\/b\\/c/m\n');
  assert.equal(doc.p.test('a/b/c'), true);
  assert.equal(doc.p.flags, 'm');
});

test('RegExp values dump with the tag and round-trip', () => {
  assert.equal(yaml.dump({ r: /ab+c/gi }), 'r: !!regexp /ab+c/gi\n');
  const back = yaml.load(yaml.dump({ r: /a\/b|c+/u }));
  assert.equal(back.r.source, /a\/b|c+/u.source);
  assert.equal(back.r.flags, 'u');
});

test('malformed regexp scalars are load errors', () => {
  assert.throws(() => yaml.load('r: !!regexp not-a-regexp'), yaml.YAMLException);
  assert.throws(() => yaml.load('r: !!regexp /abc/zz'), yaml.YAMLException);
  assert.throws(() => yaml.load('r: !!regexp [1, 2]'), yaml.YAMLException);
});

test('the type is exported for custom schemas and kept out of the core schemas', () => {
  assert.ok(yaml.types.regexp instanceof yaml.Type);
  assert.equal(yaml.types.regexp.tag, 'tag:yaml.org,2002:regexp');
  assert.throws(() => yaml.load('r: !!regexp /a/', { schema: yaml.CORE_SCHEMA }), yaml.YAMLException);
  const custom = yaml.CORE_SCHEMA.extend({ explicit: [yaml.types.regexp] });
  assert.ok(yaml.load('r: !!regexp /a/', { schema: custom }).r instanceof RegExp);
});

test('existing types are untouched', () => {
  assert.deepEqual(yaml.load('a: 0xff\nb: [1, 2]\nc: !!set {x, y}\n'), { a: 255, b: [1, 2], c: { x: null, y: null } });
});
