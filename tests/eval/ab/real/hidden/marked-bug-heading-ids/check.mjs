import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Slugger, marked } from './src/marked.js';

const ids = (md) => [...marked(md).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

test('repeated headings get unique ids', () => {
  assert.deepEqual(ids('# Intro\n\n# Intro\n\n# Intro'), ['intro', 'intro-1', 'intro-2']);
});

test('a heading whose slug equals a generated suffix does not collide', () => {
  assert.deepEqual(ids('# Intro\n\n# Intro\n\n# Intro 1'), ['intro', 'intro-1', 'intro-1-1']);
  const all = ids('# a\n\n# a\n\n# a 1\n\n# a 1\n\n# a-1-1');
  assert.equal(new Set(all).size, all.length, 'ids must be unique: ' + all.join(','));
});

test('Slugger directly: dry runs do not consume slugs', () => {
  const s = new Slugger();
  assert.equal(s.slug('Hello World'), 'hello-world');
  assert.equal(s.slug('Hello World', { dryrun: true }), 'hello-world-1');
  assert.equal(s.slug('Hello World'), 'hello-world-1');
  assert.equal(s.slug('hello world 1'), 'hello-world-1-1');
  assert.equal(s.slug('Other'), 'other');
});

test('headerIds off and headerPrefix are unaffected', () => {
  assert.equal(marked('# T', { headerIds: false }), '<h1>T</h1>\n');
  assert.equal(marked('# T', { headerPrefix: 'p-' }), '<h1 id="p-t">T</h1>\n');
});
