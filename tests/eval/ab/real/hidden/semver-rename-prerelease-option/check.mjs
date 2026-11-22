import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const s = require('./index.js');
const on = { withPrerelease: true };
const old = { includePrerelease: true };

test('satisfies / maxSatisfying honour the new option name only', () => {
  assert.equal(s.satisfies('1.2.3-beta.1', '^1.0.0', on), true);
  assert.equal(s.satisfies('1.2.3-beta.1', '^1.0.0', old), false);
  assert.equal(s.satisfies('1.2.3-beta.1', '^1.0.0'), false);
  assert.equal(s.maxSatisfying(['1.2.3', '1.3.0-beta'], '^1.0.0', on), '1.3.0-beta');
  assert.equal(s.maxSatisfying(['1.2.3', '1.3.0-beta'], '^1.0.0', old), '1.2.3');
});

test('coerce keeps prerelease and build only with the new option', () => {
  assert.equal(s.coerce('1.2.3-rc.1+b', on).version, '1.2.3-rc.1');
  assert.equal(s.coerce('1.2.3-rc.1+b', old).version, '1.2.3');
  assert.equal(s.coerce('1.2.3-rc.1+b').version, '1.2.3');
});

test('subset honours the new option name only', () => {
  assert.equal(s.subset('1.2.3-beta', '^1.0.0', on), true);
  assert.equal(s.subset('1.2.3-beta', '^1.0.0', old), false);
  assert.equal(s.subset('1.2.3-beta', '^1.0.0'), false);
});

test('Range, SemVer and Comparator expose the renamed property', () => {
  assert.equal(new s.Range('1.x', on).range, '>=1.0.0-0 <2.0.0-0');
  assert.equal(new s.Range('1.x', old).range, '>=1.0.0 <2.0.0-0');
  assert.equal(new s.Range('1.x', on).withPrerelease, true);
  assert.equal(new s.Range('1.x').withPrerelease, false);
  assert.equal(new s.SemVer('1.0.0', on).withPrerelease, true);
  assert.equal(new s.SemVer('1.0.0').withPrerelease, false);
  assert.equal(new s.Comparator('>=1.0.0', on).options.withPrerelease, true);
});

test('Range cache does not mix the two modes', () => {
  assert.equal(new s.Range('>=1.0.0', on).test('1.5.0-x'), true);
  assert.equal(new s.Range('>=1.0.0').test('1.5.0-x'), false);
  assert.equal(new s.Range('>=1.0.0', on).test('1.5.0-x'), true);
});

test('no library file still mentions the old option name', () => {
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : [],
    );
  for (const f of walk('.').filter((p) => !p.includes('check.mjs')))
    assert.doesNotMatch(readFileSync(f, 'utf8'), /includePrerelease/, f);
});
