import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const Prism = require('./prism.js');
const loadLanguages = require('./components/index.js');
const json = require('./components.json');
const js = require('./components.js');

const SAMPLE = ['# database', 'export DB_URL="postgres://x"', 'PORT = 8080', 'EMPTY=', '  # indented', 'A.B=c d'].join('\n');

// top-level tokens that are not plain whitespace text, as [type, text]
const flat = (code, grammar) =>
  Prism.tokenize(code, grammar)
    .map((t) => (typeof t === 'string' ? ['', t] : [t.type, Prism.util.stringify ? flatten(t.content) : t.content]))
    .filter(([type, text]) => type || text.trim());
const flatten = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(flatten).join('') : flatten(c.content));

test('loadLanguages knows dotenv and registers it with the env alias', () => {
  loadLanguages.silent = true;
  loadLanguages(['dotenv']);
  assert.equal(typeof Prism.languages.dotenv, 'object');
  assert.equal(Prism.languages.env, Prism.languages.dotenv);
});

test('the language metadata lists dotenv with the env alias in both copies', () => {
  for (const components of [json, js]) {
    const entry = components.languages.dotenv;
    assert.ok(entry, 'dotenv entry');
    assert.equal(typeof entry.title, 'string');
    assert.deepEqual([].concat(entry.alias ?? []), ['env']);
  }
});

test('tokenizes comments, export, keys, equals signs and values', () => {
  loadLanguages(['dotenv']);
  assert.deepEqual(flat(SAMPLE, Prism.languages.dotenv), [
    ['comment', '# database'],
    ['keyword', 'export'],
    ['key', 'DB_URL'],
    ['punctuation', '='],
    ['value', '"postgres://x"'],
    ['key', 'PORT'],
    ['punctuation', '='],
    ['value', '8080'],
    ['key', 'EMPTY'],
    ['punctuation', '='],
    ['comment', '# indented'],
    ['key', 'A.B'],
    ['punctuation', '='],
    ['value', 'c d'],
  ]);
});

test('keys and values carry the attribute aliases and highlight produces markup', () => {
  loadLanguages(['dotenv']);
  const html = Prism.highlight('A=1', Prism.languages.dotenv, 'dotenv');
  assert.match(html, /token key attr-name">A</);
  assert.match(html, /token value attr-value">1</);
});

test('existing languages are untouched', () => {
  assert.ok(json.languages.editorconfig && json.languages.ini);
  loadLanguages(['ini']);
  assert.ok(Prism.languages.ini.section);
});
