import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { getDefaults } from './src/defaults.js';
import { cleanUrl } from './src/helpers.js';
import { marked } from './src/marked.js';

test('the options are gone from the defaults', () => {
  const keys = Object.keys(getDefaults());
  assert.ok(!keys.includes('sanitize'));
  assert.ok(!keys.includes('sanitizer'));
  assert.ok(keys.includes('baseUrl') && keys.includes('headerIds'));
});

test('passing sanitize/sanitizer now has no effect and no deprecation warning', () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const plain = marked('<b>x</b> [a](javascript:alert(1)) <i>y</i>');
    assert.equal(marked('<b>x</b> [a](javascript:alert(1)) <i>y</i>', { sanitize: true }), plain);
    assert.equal(marked('<b>x</b>', { sanitize: true, sanitizer: () => 'NOPE' }), '<p><b>x</b></p>\n');
    assert.match(plain, /<a href="javascript:alert\(1\)">a<\/a>/);
  } finally {
    console.warn = orig;
  }
  assert.deepEqual(warns, []);
});

test('cleanUrl takes (base, href) only', () => {
  assert.equal(cleanUrl('http://ex.com/base/', 'rel/p'), 'http://ex.com/base/rel/p');
  assert.equal(cleanUrl(null, 'http://a.b/c d'), 'http://a.b/c%20d');
  assert.equal(cleanUrl(null, 'javascript:alert(1)'), 'javascript:alert(1)');
  assert.equal(cleanUrl(null, '\ud800'), null);
});

test('links and images still resolve against baseUrl', () => {
  assert.equal(
    marked('[l](rel/p "t") ![i](a.png)', { baseUrl: 'http://ex.com/base/' }),
    '<p><a href="http://ex.com/base/rel/p" title="t">l</a> <img src="http://ex.com/base/a.png" alt="i"></p>\n',
  );
});

test('inline and block html pass through untouched', () => {
  assert.equal(marked('<div>raw</div>\n\ntext <i>x</i>'), '<div>raw</div>\n\n<p>text <i>x</i></p>\n');
});

test('no source file mentions sanitize any more', () => {
  for (const f of readdirSync('src').filter((n) => n.endsWith('.js')))
    assert.doesNotMatch(readFileSync(`src/${f}`, 'utf8'), /sanitiz/i, f);
});
