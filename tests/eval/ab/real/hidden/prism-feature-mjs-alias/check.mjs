import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const Prism = require('./prism.js');
const loadLanguages = require('./components/index.js');
const json = require('./components.json');
const js = require('./components.js');

const aliasesOf = (components) => [].concat(components.languages.javascript.alias ?? []).sort();

test('the bundled prism.js treats mjs exactly like js', () => {
  assert.equal(Prism.languages.mjs, Prism.languages.javascript);
  assert.equal(Prism.languages.js, Prism.languages.javascript);
  const code = 'const a = () => `x${1}`;';
  assert.equal(
    Prism.highlight(code, Prism.languages.mjs, 'mjs'),
    Prism.highlight(code, Prism.languages.js, 'js'),
  );
});

test('loading the javascript component registers mjs again', () => {
  delete Prism.languages.mjs;
  delete Prism.languages.js;
  loadLanguages(['javascript']);
  assert.equal(Prism.languages.mjs, Prism.languages.javascript);
  assert.equal(Prism.languages.js, Prism.languages.javascript);
});

test('typescript, which extends javascript, still loads and highlights', () => {
  loadLanguages(['typescript']);
  assert.match(
    Prism.highlight('let a: number = 1;', Prism.languages.typescript, 'typescript'),
    /token keyword/,
  );
});

test('both copies of the language metadata list mjs next to js', () => {
  assert.deepEqual(aliasesOf(json), ['js', 'mjs']);
  assert.deepEqual(aliasesOf(js), ['js', 'mjs']);
});

test('other aliases stay as they were', () => {
  assert.deepEqual(json.languages.markup.alias, [
    'html',
    'xml',
    'svg',
    'mathml',
    'ssml',
    'atom',
    'rss',
  ]);
  assert.equal(json.languages.antlr4.alias, 'g4');
  assert.equal(typeof Prism.languages.html, 'object');
});
