import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDuration } from '../src/duration.mjs';

test('parses a single unit', () => {
  assert.equal(parseDuration('90s'), 90_000);
  assert.equal(parseDuration('5m'), 300_000);
  assert.equal(parseDuration('2h'), 7_200_000);
});

test('trims surrounding whitespace', () => {
  assert.equal(parseDuration(' 5m '), 300_000);
});

test('rejects text that is not a duration', () => {
  for (const bad of ['', '1x', 'h', '-5m', '1.5h'])
    assert.throws(() => parseDuration(bad), RangeError, bad);
});
