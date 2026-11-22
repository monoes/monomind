import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime, Duration } from './src/luxon.js';

const utc = (y, m = 1, d = 1) => DateTime.utc(y, m, d);

test('Duration accepts and exposes decades', () => {
  const d = Duration.fromObject({ decades: 2 });
  assert.equal(d.decades, 2);
  assert.equal(d.years, 0);
  assert.equal(Duration.fromObject({ decade: 1 }).decades, 1);
  assert.equal(Duration.fromObject({ years: 3 }).decades, 0);
  assert.equal(Duration.normalizeUnit('decade'), 'decades');
  assert.equal(Duration.normalizeUnit('decades'), 'decades');
});

test('conversions between decades and the other units', () => {
  assert.equal(Duration.fromObject({ decades: 1 }).as('years'), 10);
  assert.equal(Duration.fromObject({ decades: 1 }).as('months'), 120);
  assert.equal(Duration.fromObject({ decades: 1 }).as('quarters'), 40);
  assert.equal(Duration.fromObject({ years: 25 }).as('decades'), 2.5);
  assert.deepEqual(Duration.fromObject({ years: 25 }).shiftTo('decades', 'years').toObject(), { decades: 2, years: 5 });
  assert.equal(Duration.fromObject({ decades: 1.5 }).shiftTo('years').years, 15);
  assert.equal(Duration.fromObject({ decades: 1 }, { conversionAccuracy: 'longterm' }).as('days'), 3652.425);
  assert.equal(Duration.fromObject({ decades: 1 }).as('days'), 3650);
});

test('ISO output folds decades into years', () => {
  assert.equal(Duration.fromObject({ decades: 2 }).toISO(), 'P20Y');
  assert.equal(Duration.fromObject({ years: 3, decades: 1 }).toISO(), 'P13Y');
  assert.equal(Duration.fromObject({ years: 1 }).toISO(), 'P1Y');
});

test('DateTime plus and minus', () => {
  assert.equal(utc(2000, 6, 15).plus({ decades: 2 }).toISODate(), '2020-06-15');
  assert.equal(utc(2000, 6, 15).minus({ decades: 1 }).toISODate(), '1990-06-15');
  assert.equal(utc(2000, 6, 15).plus({ decades: 1, years: 2 }).year, 2012);
  assert.equal(utc(2000, 2, 29).plus({ decades: 2 }).toISODate(), '2020-02-29');
  assert.equal(utc(2000, 2, 29).plus({ decades: 1 }).toISODate(), '2010-02-28');
  assert.equal(utc(2000, 6, 15).plus({ decades: 0.5 }).year, 2005);
  assert.equal(utc(2000, 6, 15).plus(Duration.fromObject({ decades: 3 })).year, 2030);
});

test('DateTime diff in decades', () => {
  assert.equal(utc(2030).diff(utc(2000), 'decades').decades, 3);
  assert.ok(Math.abs(utc(2025).diff(utc(2000), 'decades').decades - 2.5) < 0.01);
  assert.deepEqual(utc(2025).diff(utc(2000), ['decades', 'years']).toObject(), { decades: 2, years: 5 });
  assert.equal(utc(2000).diff(utc(2030), 'decades').decades, -3);
  assert.equal(utc(2029, 12, 31).diff(utc(2000), ['decades']).decades < 3, true);
});

test('existing units are unaffected', () => {
  assert.equal(Duration.fromObject({ years: 1 }).as('quarters'), 4);
  assert.equal(utc(2000, 1, 31).plus({ months: 1 }).toISODate(), '2000-02-29');
  assert.equal(utc(2020).diff(utc(2000), 'years').years, 20);
  assert.deepEqual(Duration.fromObject({ days: 400 }).shiftTo('years', 'days').toObject(), { years: 1, days: 35 });
});
