import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseZoneInfo } from './src/impl/util.js';
import { DateTime, IANAZone, Settings, SystemZone } from './src/luxon.js';

const JAN = Date.UTC(2020, 0, 15, 12);
const JUL = Date.UTC(2020, 6, 1, 12);

test('parseZoneInfo takes an options object', () => {
  assert.equal(
    parseZoneInfo(JAN, { offsetFormat: 'short', locale: 'en-US', timeZone: 'America/New_York' }),
    'EST',
  );
  assert.equal(
    parseZoneInfo(JUL, { offsetFormat: 'short', locale: 'en-US', timeZone: 'America/New_York' }),
    'EDT',
  );
  assert.equal(
    parseZoneInfo(JUL, { offsetFormat: 'long', locale: 'en-US', timeZone: 'America/New_York' }),
    'Eastern Daylight Time',
  );
});

test('timeZone is optional and falls back to the system zone (TZ=UTC in this check)', () => {
  assert.equal(parseZoneInfo(JAN, { offsetFormat: 'short', locale: 'en-US' }), 'UTC');
  assert.equal(
    parseZoneInfo(JAN, { offsetFormat: 'long', locale: 'en-US' }),
    'Coordinated Universal Time',
  );
});

test('the old positional form is no longer understood', () => {
  assert.notEqual(parseZoneInfo(JAN, 'short', 'en-US', 'America/New_York'), 'EST');
});

test('zones still produce their offset names', () => {
  const tokyo = new IANAZone('Asia/Tokyo');
  assert.equal(tokyo.offsetName(JAN, { format: 'short', locale: 'en-US' }), 'GMT+9');
  assert.equal(tokyo.offsetName(JAN, { format: 'long', locale: 'en-US' }), 'Japan Standard Time');
  assert.equal(SystemZone.instance.offsetName(JAN, { format: 'short', locale: 'en-US' }), 'UTC');
  assert.equal(
    SystemZone.instance.offsetName(JAN, { format: 'long', locale: 'en-US' }),
    'Coordinated Universal Time',
  );
});

test('DateTime offset names and format tokens work end to end', () => {
  const ny = DateTime.fromISO('2020-07-01T12:00', { zone: 'America/New_York', locale: 'en-US' });
  assert.equal(ny.offsetNameShort, 'EDT');
  assert.equal(ny.offsetNameLong, 'Eastern Daylight Time');
  assert.equal(ny.toFormat('ZZZZ'), 'EDT');
  assert.equal(ny.toFormat('ZZZZZ'), 'Eastern Daylight Time');
  const prev = Settings.defaultZone;
  Settings.defaultZone = 'system';
  try {
    assert.equal(DateTime.fromISO('2020-01-15T12:00', { locale: 'en-US' }).offsetNameShort, 'UTC');
  } finally {
    Settings.defaultZone = prev;
  }
});

test('every call site uses the options form', () => {
  for (const f of ['src/zones/IANAZone.js', 'src/zones/systemZone.js']) {
    const calls = readFileSync(f, 'utf8').match(/parseZoneInfo\([^)]*\)/g) ?? [];
    assert.ok(calls.length >= 1, f);
    for (const c of calls) assert.match(c, /parseZoneInfo\(ts, \{/, c);
  }
});
