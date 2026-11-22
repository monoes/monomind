import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const semver = require('./index.js');

const versions = ['1.0.0', '1.2.3', 'not-a-version', '2.0.0', '1.5.0-beta.1', '1.9.9'];

test('Range#filter keeps matching entries in input order and skips invalid ones', () => {
  const r = new semver.Range('^1.0.0');
  assert.deepEqual(r.filter(versions), ['1.0.0', '1.2.3', '1.9.9']);
  assert.deepEqual(r.filter([]), []);
});

test('Range#filter follows the range options', () => {
  const r = new semver.Range('^1.0.0', { includePrerelease: true });
  assert.deepEqual(r.filter(versions), ['1.0.0', '1.2.3', '1.5.0-beta.1', '1.9.9']);
});

test('Range#filter returns the original entries, not parsed copies', () => {
  const v = new semver.SemVer('1.4.0');
  const out = new semver.Range('^1.0.0').filter([v, '1.1.0']);
  assert.equal(out[0], v);
  assert.equal(out[1], '1.1.0');
});

test('semver.filterSatisfying is exported and uses the same rules', () => {
  assert.equal(typeof semver.filterSatisfying, 'function');
  assert.deepEqual(semver.filterSatisfying(versions, '>=1.2.0 <2.0.0'), ['1.2.3', '1.9.9']);
  assert.deepEqual(semver.filterSatisfying(versions, '^1.0.0', { includePrerelease: true }), [
    '1.0.0',
    '1.2.3',
    '1.5.0-beta.1',
    '1.9.9',
  ]);
});

test('an invalid range yields an empty array instead of throwing', () => {
  assert.deepEqual(semver.filterSatisfying(versions, 'this is not a range'), []);
});

test('it lives next to the other range helpers', () => {
  assert.equal(require('./ranges/filter-satisfying.js'), semver.filterSatisfying);
});
