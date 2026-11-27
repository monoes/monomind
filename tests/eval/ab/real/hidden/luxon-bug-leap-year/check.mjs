import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime, Duration, Info, Interval } from './src/luxon.js';

test('century years divisible by 400 are leap years', () => {
  assert.equal(DateTime.utc(2000, 2, 29).isValid, true);
  assert.equal(DateTime.utc(2400, 2, 29).isValid, true);
  assert.equal(DateTime.utc(2000).isInLeapYear, true);
  assert.equal(DateTime.utc(2000).daysInYear, 366);
  assert.equal(DateTime.utc(2000, 2).daysInMonth, 29);
});

test('other century years are not', () => {
  assert.equal(DateTime.utc(1900, 2, 29).isValid, false);
  assert.equal(DateTime.utc(2100, 2, 29).isValid, false);
  assert.equal(DateTime.utc(1900).isInLeapYear, false);
  assert.equal(DateTime.utc(2100, 2).daysInMonth, 28);
});

test('ordinary years behave as before', () => {
  assert.equal(DateTime.utc(2024, 2, 29).isValid, true);
  assert.equal(DateTime.utc(2023, 2, 29).isValid, false);
  assert.equal(DateTime.utc(2024).daysInYear, 366);
  assert.equal(DateTime.utc(2023).daysInYear, 365);
});

test('arithmetic across 2000 uses the right number of days', () => {
  assert.equal(DateTime.utc(2000, 1, 31).plus({ months: 1 }).toISODate(), '2000-02-29');
  assert.equal(
    DateTime.utc(1999, 3, 1)
      .plus({ years: 1 })
      .diff(DateTime.utc(1999, 3, 1), 'days').days,
    366,
  );
  assert.equal(DateTime.utc(2000, 12, 31).ordinal, 366);
  assert.equal(
    DateTime.fromObject({ year: 2000, ordinal: 60 }, { zone: 'UTC' }).toISODate(),
    '2000-02-29',
  );
  assert.equal(
    Interval.fromDateTimes(DateTime.utc(2000, 2, 1), DateTime.utc(2000, 3, 1)).length('days'),
    29,
  );
  assert.equal(Duration.fromObject({ months: 1 }).as('days'), 30);
});

test('week-year helpers are unaffected', () => {
  assert.equal(DateTime.utc(2004, 12, 31).weeksInWeekYear, 53);
  assert.equal(Info.months('short', { locale: 'en' }).length, 12);
});
