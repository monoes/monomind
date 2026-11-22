import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const semver = require('./index.js');

test('sort orders build metadata numerically (CI build numbers)', () => {
  assert.deepEqual(semver.sort(['1.2.3+build.100', '1.2.3+build.20', '1.2.3+build.3']), [
    '1.2.3+build.3',
    '1.2.3+build.20',
    '1.2.3+build.100',
  ]);
  assert.deepEqual(semver.rsort(['1.2.3+20', '1.2.3+100', '1.2.3+9']), [
    '1.2.3+100',
    '1.2.3+20',
    '1.2.3+9',
  ]);
});

test('compareBuild compares multi-digit build ids as numbers', () => {
  assert.equal(semver.compareBuild('1.0.0+20', '1.0.0+100'), -1);
  assert.equal(semver.compareBuild('1.0.0+100', '1.0.0+20'), 1);
  assert.equal(semver.compareBuild('1.0.0+7', '1.0.0+7'), 0);
});

test('mixed numeric and alphanumeric identifiers keep their order', () => {
  assert.equal(semver.compareIdentifiers('100', 'alpha'), -1);
  assert.equal(semver.compareIdentifiers('alpha', '100'), 1);
  assert.equal(semver.compareIdentifiers('alpha', 'beta'), -1);
  assert.equal(semver.compareIdentifiers('20', '100'), -1);
  assert.equal(semver.compareIdentifiers('100', '20'), 1);
});

test('ordinary precedence is unaffected', () => {
  assert.equal(semver.compare('1.20.0', '1.100.0'), -1);
  assert.equal(semver.compare('1.0.0-rc.20', '1.0.0-rc.100'), -1);
  assert.equal(semver.compare('1.0.0-alpha', '1.0.0-1'), 1);
  assert.equal(semver.maxSatisfying(['1.20.0', '1.100.0', '1.3.0'], '^1.0.0'), '1.100.0');
});
