import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const Prism = require('./prism.js');
const load = require('./components/index.js');

const JS =
  "// note\nconst s = 'a' + `b${1}`;\nlet re = /x+/g, n = 0x1F;\nclass A { #p = 1; static m() {} }\n";
const before = Prism.highlight(JS, Prism.languages.javascript, 'javascript');

test('plain javascript highlights the same before and after derived languages are loaded', () => {
  assert.match(before, /<span class="token comment">\/\/ note<\/span>/);
  for (const lang of ['coffeescript', 'typescript', 'jsx', 'flow', 'actionscript']) {
    load([lang]);
    assert.equal(
      Prism.highlight(JS, Prism.languages.javascript, 'javascript'),
      before,
      `after loading ${lang}`,
    );
  }
});

test('the derived languages still differ from javascript where they should', () => {
  assert.ok(Prism.languages.coffeescript.comment);
  assert.notEqual(Prism.languages.coffeescript.comment, Prism.languages.javascript.comment);
  assert.ok(Prism.languages.typescript['class-name']);
});

test('extend returns a new grammar and leaves the source grammar alone', () => {
  const keys = Object.keys(Prism.languages.markup);
  const derived = Prism.languages.extend('markup', { extra: /zzz/ });
  assert.notEqual(derived, Prism.languages.markup);
  assert.deepEqual(Object.keys(Prism.languages.markup), keys);
  assert.equal(Prism.languages.markup.extra, undefined);
  assert.ok(derived.extra && derived.tag);
});

test('the standalone core component carries the same logic as the bundle', () => {
  const core = readFileSync('components/prism-core.js', 'utf8');
  assert.match(core, /var lang = _\.util\.clone\(_\.languages\[id\]\);/);
});
