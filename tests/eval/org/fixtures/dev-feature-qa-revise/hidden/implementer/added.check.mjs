// The tests a careful implementer writes from the task alone: the ISO form and the old behaviour.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDuration } from '../../src/duration.mjs';

test('parses ISO-8601 time durations', () => {
  assert.equal(parseDuration('PT1H30M'), 5_400_000);
  assert.equal(parseDuration('PT45S'), 45_000);
  assert.equal(parseDuration('PT2H'), 7_200_000);
});

test('rejects an empty ISO form', () => {
  assert.throws(() => parseDuration('PT'), RangeError);
});
