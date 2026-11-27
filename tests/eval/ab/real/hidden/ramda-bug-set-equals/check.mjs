import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as R from './source/index.js';

const eqLen = (a, b) => a.length === b.length;

test('equals compares sets irrespective of order', () => {
  assert.equal(R.equals(new Set([1, 2, 3]), new Set([3, 2, 1])), true);
  assert.equal(R.equals(new Set([1]), new Set([1])), true);
  assert.equal(R.equals(new Set([[1], { a: 2 }]), new Set([{ a: 2 }, [1]])), true);
  assert.equal(R.equals(new Set([1, 2, 3]), new Set([1, 2, 4])), false);
  assert.equal(R.equals(new Set([1, 2]), new Set([1, 2, 3])), false);
});

test('equals compares maps by entries irrespective of order', () => {
  assert.equal(
    R.equals(
      new Map([
        ['a', 1],
        ['b', 2],
      ]),
      new Map([
        ['b', 2],
        ['a', 1],
      ]),
    ),
    true,
  );
  assert.equal(R.equals(new Map([['a', [1]]]), new Map([['a', [1]]])), true);
  assert.equal(R.equals(new Map([['a', 1]]), new Map([['a', 2]])), false);
});

test('uniqWith keeps the first of each equivalence class, including a match against the last kept element', () => {
  assert.deepEqual(R.uniqWith(eqLen, ['a', 'bb', 'c', 'dd', 'eee']), ['a', 'bb', 'eee']);
  assert.deepEqual(R.uniqWith(R.equals, [1, 1]), [1]);
  assert.deepEqual(R.uniqWith(R.equals, [[1], [2], [1]]), [[1], [2]]);
});

test('differenceWith removes every element that matches anything in the second list', () => {
  assert.deepEqual(R.differenceWith(eqLen, ['a', 'bb', 'ccc'], ['x']), ['bb', 'ccc']);
  assert.deepEqual(R.differenceWith(R.equals, [1, 2, 3], [3]), [1, 2]);
  assert.deepEqual(R.differenceWith(R.equals, [1, 2, 3], [4, 5, 1]), [2, 3]);
});

test('innerJoin keeps elements that match some element of the second list', () => {
  assert.deepEqual(
    R.innerJoin((a, b) => a.id === b, [{ id: 1 }, { id: 2 }, { id: 3 }], [3]),
    [{ id: 3 }],
  );
  assert.deepEqual(
    R.innerJoin((a, b) => a === b, [1, 2, 3], [1, 3]),
    [1, 3],
  );
});

test('the transducer form of uniqWith agrees', () => {
  assert.deepEqual(R.into([], R.uniqWith(eqLen), ['a', 'bb', 'c', 'dd', 'eee']), [
    'a',
    'bb',
    'eee',
  ]);
  assert.deepEqual(R.intersection([1, 2, 3], [3]), [3]);
  assert.deepEqual(R.union([1, 2], [2, 3]), [1, 2, 3]);
});
