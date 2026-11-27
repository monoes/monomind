import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const lodash = require('./lodash.js');
const fp = require('./fp/_baseConvert')(lodash.runInContext(), lodash.runInContext());

const objs = [{ n: 9 }, { n: 2 }, { n: 4 }];
const even = [{ n: 10 }, { n: 1 }, { n: 4 }, { n: 3 }];

for (const [name, medianBy] of [
  ['single-file build', lodash.medianBy],
  [
    'per-method module',
    (() => {
      try {
        return require('./medianBy');
      } catch {
        return undefined;
      }
    })(),
  ],
]) {
  test(`${name}: median of the iteratee values`, () => {
    assert.equal(typeof medianBy, 'function');
    assert.equal(medianBy(objs, 'n'), 4);
    assert.equal(medianBy(even, 'n'), 3.5);
    assert.equal(
      medianBy(objs, (o) => -o.n),
      -4,
    );
    assert.equal(medianBy([5, 1, 3]), 3);
    assert.equal(medianBy([[2], [8]], 0), 5);
  });

  test(`${name}: edge cases`, () => {
    assert.ok(Number.isNaN(medianBy([], 'n')));
    assert.ok(Number.isNaN(medianBy(null, 'n')));
    assert.equal(medianBy([7], 'n'.length ? (x) => x : undefined), 7);
    const input = [{ n: 3 }, { n: 1 }, { n: 2 }];
    medianBy(input, 'n');
    assert.deepEqual(
      input.map((o) => o.n),
      [3, 1, 2],
    );
  });
}

test('it is listed in the Math category module', () => {
  assert.equal(require('./math').medianBy, require('./medianBy'));
  assert.equal(require('./math').meanBy, require('./meanBy'));
});

test('chaining returns the unwrapped number, like meanBy', () => {
  assert.equal(lodash(objs).medianBy('n'), 4);
  assert.equal(lodash(objs).meanBy('n'), 5);
  assert.equal(lodash.chain(objs).medianBy('n').value(), 4);
});

test('the fp variant is iteratee-first and curried', () => {
  assert.equal(fp.medianBy('n', objs), 4);
  assert.equal(fp.medianBy('n')(even), 3.5);
  assert.equal(fp.medianBy((o) => o.n)(objs), 4);
  assert.equal(fp.meanBy('n', objs), 5);
});

test('the fp per-method file exists and is a converted method', () => {
  const m = require('./fp/medianBy');
  assert.equal(typeof m, 'function');
  assert.equal(m.placeholder, require('./fp/placeholder'));
});
