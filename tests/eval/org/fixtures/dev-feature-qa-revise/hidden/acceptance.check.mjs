// QA's checks, hidden from the implementer: the copied-in file sits in test/ only while QA verifies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDuration } from '../src/duration.mjs';

test('parses the ISO-8601 time form', () => {
  assert.equal(parseDuration('PT1H30M'), 5_400_000);
  assert.equal(parseDuration('PT45S'), 45_000);
  assert.equal(parseDuration('PT2H'), 7_200_000);
});

test('still parses compound durations, largest unit first', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('1h1m1s'), 3_661_000);
});

test('rejects units out of order, repeated, or malformed ISO forms', () => {
  for (const bad of ['30m1h', '1h1h', 'PT', 'PT1M1H', 'pt1h'])
    assert.throws(() => parseDuration(bad), RangeError, bad);
});

test('whitespace inside a duration is an error (the module says so); only the ends are trimmed', () => {
  assert.equal(parseDuration(' 5m '), 300_000);
  for (const bad of ['1h 30m', '1 h', '5 m', 'PT1H 30M', 'PT 45S'])
    assert.throws(() => parseDuration(bad), RangeError, bad);
});

test('still parses and rejects what it did before', () => {
  assert.equal(parseDuration('90s'), 90_000);
  for (const bad of ['', '1x', 'h', '-5m', '1.5h'])
    assert.throws(() => parseDuration(bad), RangeError, bad);
});
