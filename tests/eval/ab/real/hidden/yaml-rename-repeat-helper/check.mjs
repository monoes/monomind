import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const common = require('./lib/common');
const yaml = require('./index.js');

test('common exports repeatString and no longer repeat', () => {
  assert.equal(typeof common.repeatString, 'function');
  assert.equal(common.repeatString('ab', 3), 'ababab');
  assert.equal(common.repeatString('x', 0), '');
  assert.equal('repeat' in common, false);
});

test('no module still calls common.repeat', () => {
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : [],
    );
  for (const f of [...walk('lib'), 'index.js'])
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\bcommon\.repeat\b/, f);
});

test('error snippets (snippet.js) still render', () => {
  assert.throws(
    () => yaml.load('a: [1,\n  b: }'),
    (e) =>
      e instanceof yaml.YAMLException &&
      e.message === 'missed comma between flow collection entries (2:6)\n\n 1 | a: [1,\n 2 |   b: }\n----------^',
  );
});

test('dumper indentation and unicode escapes still work', () => {
  assert.equal(
    yaml.dump({ a: { b: [1, 2, { c: 'x\ny' }] } }, { indent: 4 }),
    'a:\n    b:\n        - 1\n        - 2\n        -\n            c: |-\n                x\n                y\n',
  );
  assert.equal(yaml.dump('\u0007', { forceQuotes: true }), '"\\a"\n');
});

test('loader block scalars keep their blank lines', () => {
  assert.deepEqual(yaml.load('a: |\n  l1\n\n\n  l2\nb: >\n  x\n\n  y\n'), { a: 'l1\n\n\nl2\n', b: 'x\ny\n' });
});
