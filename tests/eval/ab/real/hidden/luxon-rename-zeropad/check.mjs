import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import * as util from './src/impl/util.js';
import { DateTime, Duration, FixedOffsetZone } from './src/luxon.js';

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : [],
  );

test('util exports zeroPad and no longer the free function padStart', () => {
  assert.equal(typeof util.zeroPad, 'function');
  assert.equal(util.zeroPad(5), '05');
  assert.equal(util.zeroPad(5, 4), '0005');
  assert.equal(util.zeroPad(-5, 3), '-005');
  assert.equal(util.padStart, undefined);
});

test('no module imports or calls the old helper (String#padStart is fine)', () => {
  for (const f of walk('src')) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /import[^;]*\bpadStart\b[^;]*from/, f);
    assert.doesNotMatch(src, /(?<![.\w])padStart\s*\(/, f);
  }
  assert.match(readFileSync('src/impl/util.js', 'utf8'), /\.padStart\(n, "0"\)/);
});

test('ISO and custom formatting are unchanged', () => {
  const dt = DateTime.fromObject(
    { year: 5, month: 3, day: 9, hour: 7, minute: 4, second: 2, millisecond: 6 },
    { zone: 'UTC' },
  );
  assert.equal(dt.toISO(), '0005-03-09T07:04:02.006Z');
  assert.equal(dt.toISODate(), '0005-03-09');
  assert.equal(dt.toISOTime(), '07:04:02.006Z');
  assert.equal(dt.set({ millisecond: 0 }).toISOTime({ suppressMilliseconds: true }), '07:04:02Z');
  assert.equal(
    DateTime.fromObject({ year: -1 }, { zone: 'UTC' }).toISO(),
    '-000001-01-01T00:00:00.000Z',
  );
  assert.equal(dt.toFormat('yyyy-MM-dd HH:mm:ss.SSS'), '0005-03-09 07:04:02.006');
  const z = DateTime.fromISO('2020-02-03T04:05:06', { zone: FixedOffsetZone.instance(-330) });
  assert.equal(z.toISO(), '2020-02-03T04:05:06.000-05:30');
  assert.equal(z.toFormat('ZZ Z'), '-05:30 -5:30');
  assert.equal(z.toFormat('ZZZ'), '-0530');
  assert.equal(util.formatOffset(-330, 'narrow'), '-5:30');
  assert.equal(util.formatOffset(570, 'techie'), '+0930');
});

test('duration formatting is unchanged', () => {
  assert.equal(
    Duration.fromObject({ hours: 5, minutes: 7, seconds: 3 }).toFormat('hh:mm:ss'),
    '05:07:03',
  );
  assert.equal(
    Duration.fromObject({ minutes: 7, milliseconds: 9 }).toFormat('mm:ss.SSS'),
    '07:00.009',
  );
});
