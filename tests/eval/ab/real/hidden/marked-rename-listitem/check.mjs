import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { marked, Renderer } from './src/marked.js';

const LIST = '- a\n- [x] b\n- [ ] c\n\n1. one\n2. two\n';
const LIST_HTML =
  '<ul>\n<li>a</li>\n<li><input checked="" disabled="" type="checkbox"> b</li>\n<li><input disabled="" type="checkbox"> c</li>\n</ul>\n<ol>\n<li>one</li>\n<li>two</li>\n</ol>\n';

test('Renderer exposes listItem and no longer listitem', () => {
  assert.equal(typeof Renderer.prototype.listItem, 'function');
  assert.equal(Renderer.prototype.listitem, undefined);
});

test('default rendering is unchanged', () => {
  assert.equal(marked(LIST), LIST_HTML);
});

test('a renderer override named listItem is used by the parser for every item', () => {
  const r = new Renderer();
  r.listItem = (text, task, checked) =>
    `<li data-task="${task}" data-checked="${checked}">${text}</li>\n`;
  const html = marked(LIST, { renderer: r });
  assert.equal((html.match(/data-task=/g) ?? []).length, 5);
  assert.match(html, /<li data-task="true" data-checked="true"><input checked/);
  assert.match(html, /<li data-task="false" data-checked="undefined">one<\/li>/);
});

test('an override under the old name is ignored', () => {
  const r = new Renderer();
  r.listitem = () => 'OLD';
  assert.equal(marked('- a\n', { renderer: r }), '<ul>\n<li>a</li>\n</ul>\n');
});

test('marked.use accepts a listItem renderer', () => {
  marked.use({ renderer: { listItem: (t) => `<li class="x">${t}</li>\n` } });
  assert.match(marked('- a\n- b\n'), /<li class="x">a<\/li>/);
});

test('no source file still mentions the old name', () => {
  for (const f of readdirSync('src').filter((n) => n.endsWith('.js')))
    assert.doesNotMatch(readFileSync(`src/${f}`, 'utf8'), /listitem/, f);
});
