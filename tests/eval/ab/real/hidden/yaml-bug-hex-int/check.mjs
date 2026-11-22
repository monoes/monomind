import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const yaml = require('./index.js');

test('hex integers load as numbers regardless of letter case', () => {
  assert.deepEqual(yaml.load('a: 0xff\nb: 0xFF\nc: 0xDEADBEEF\nd: 0xdeadbeef\ne: -0xAB_CD\n'), {
    a: 255,
    b: 255,
    c: 3735928559,
    d: 3735928559,
    e: -43981,
  });
});

test('strings that look like hex are quoted on dump', () => {
  assert.equal(yaml.dump({ a: '0xFF', b: '0xDEADBEEF' }), "a: '0xFF'\nb: '0xDEADBEEF'\n");
});

test('other integer and string forms are unchanged', () => {
  assert.deepEqual(yaml.load('a: 0b101\nb: 0o17\nc: 1_000\nd: 0xG1\ne: 12\n'), {
    a: 5,
    b: 15,
    c: 1000,
    d: '0xG1',
    e: 12,
  });
  assert.equal(yaml.dump({ x: 255 }), 'x: 255\n');
});
