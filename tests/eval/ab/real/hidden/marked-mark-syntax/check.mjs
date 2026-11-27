import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lexer, marked, Renderer } from './src/marked.js';

test('==text== renders as <mark>', () => {
  assert.equal(marked('a ==b== c'), '<p>a <mark>b</mark> c</p>\n');
  assert.equal(marked.parseInline('==x== and ==y=='), '<mark>x</mark> and <mark>y</mark>');
});

test('inline markup nests inside', () => {
  assert.equal(
    marked('==*x* and **y**=='),
    '<p><mark><em>x</em> and <strong>y</strong></mark></p>\n',
  );
  assert.equal(marked('~~==x==~~'), '<p><del><mark>x</mark></del></p>\n');
});

test('whitespace-padded or unclosed markers and code spans are left alone', () => {
  assert.equal(marked('a == b == c'), '<p>a == b == c</p>\n');
  assert.equal(marked('a ==b c'), '<p>a ==b c</p>\n');
  assert.equal(marked('`==x==`'), '<p><code>==x==</code></p>\n');
  assert.equal(marked('1 = 2 and a=b'), '<p>1 = 2 and a=b</p>\n');
});

test('it is a gfm feature, off when gfm is false', () => {
  assert.equal(marked('==a==', { gfm: false }), '<p>==a==</p>\n');
});

test('the lexer produces a mark token with child tokens', () => {
  const [tok] = Lexer.lexInline('==y==');
  assert.equal(tok.type, 'mark');
  assert.equal(tok.raw, '==y==');
  assert.equal(tok.text, 'y');
  assert.deepEqual(
    tok.tokens.map((t) => t.type),
    ['text'],
  );
});

test('the renderer has a mark method that can be overridden', () => {
  assert.equal(typeof Renderer.prototype.mark, 'function');
  const r = new Renderer();
  r.mark = (t) => `<b class="hl">${t}</b>`;
  assert.equal(marked('==z==', { renderer: r }), '<p><b class="hl">z</b></p>\n');
});

test('heading ids ignore the markers (text renderer)', () => {
  assert.equal(marked('# a ==b== c'), '<h1 id="a-b-c">a <mark>b</mark> c</h1>\n');
});

test('existing syntax still works', () => {
  assert.equal(marked('~~d~~ and *e*'), '<p><del>d</del> and <em>e</em></p>\n');
  assert.equal(
    marked('x@example.com', { mangle: false }),
    '<p><a href="mailto:x@example.com">x@example.com</a></p>\n',
  );
});
