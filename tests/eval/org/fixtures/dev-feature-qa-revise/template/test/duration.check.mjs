import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDuration } from '../src/duration.mjs';

test('parses a single unit', () => {
  assert.equal(parseDuration('90s'), 90_000);
  assert.equal(parseDuration('5m'), 300_000);
  assert.equal(parseDuration('2h'), 7_200_000);
});

test('parses compound durations, largest unit first', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('2m30s'), 150_000);
});

test('trims the ends of the text', () => {
  assert.equal(parseDuration(' 5m '), 300_000);
});

test('rejects text that is not a duration', () => {
  for (const bad of ['', '1x', 'h', '-5m', '1.5h', '30m1h'])
    assert.throws(() => parseDuration(bad), RangeError, bad);
});
