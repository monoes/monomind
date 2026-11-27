import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const monolith = require('./lodash.js');
const modular = {
  sortedIndex: require('./sortedIndex'),
  sortedLastIndex: require('./sortedLastIndex'),
  sortedIndexBy: require('./sortedIndexBy'),
  sortedLastIndexBy: require('./sortedLastIndexBy'),
  sortedLastIndexOf: require('./sortedLastIndexOf'),
  sortedIndexOf: require('./sortedIndexOf'),
  sortedUniq: require('./sortedUniq'),
};

for (const [name, _] of [
  ['require("lodash")', monolith],
  ['per-method requires', modular],
]) {
  test(`${name}: sortedLastIndex finds the end of a run of equal values`, () => {
    assert.equal(_.sortedLastIndex([4, 5, 5, 5, 6], 5), 4);
    assert.equal(_.sortedLastIndex([4, 5, 5, 5, 6], 4), 1);
    assert.equal(_.sortedLastIndex([4, 5, 5, 5, 6], 7), 5);
    assert.equal(_.sortedLastIndex([4, 5, 5, 5, 6], 3), 0);
    assert.equal(_.sortedLastIndex([], 3), 0);
  });

  test(`${name}: sortedIndex still finds the start of a run`, () => {
    assert.equal(_.sortedIndex([4, 5, 5, 5, 6], 5), 1);
    assert.equal(_.sortedIndex([30, 50], 40), 1);
  });

  test(`${name}: sortedLastIndexBy honours the iteratee and equal runs`, () => {
    const objs = [{ x: 4 }, { x: 5 }, { x: 5 }, { x: 5 }, { x: 6 }];
    assert.equal(_.sortedLastIndexBy(objs, { x: 5 }, 'x'), 4);
    assert.equal(_.sortedIndexBy(objs, { x: 5 }, 'x'), 1);
    assert.equal(
      _.sortedLastIndexBy(objs, { x: 5 }, (o) => o.x),
      4,
    );
  });

  test(`${name}: sortedLastIndexOf returns the last matching index`, () => {
    assert.equal(_.sortedLastIndexOf([4, 5, 5, 5, 6], 5), 3);
    assert.equal(_.sortedLastIndexOf([4, 5, 5, 5, 6], 7), -1);
    assert.equal(_.sortedIndexOf([4, 5, 5, 5, 6], 5), 1);
  });

  test(`${name}: sortedLastIndex on strings and mixed null/NaN keeps lodash ordering`, () => {
    assert.equal(_.sortedLastIndex(['a', 'b', 'b', 'c'], 'b'), 3);
    assert.equal(_.sortedLastIndex([1, 2, NaN, NaN], NaN), 4);
    assert.equal(_.sortedLastIndexBy([{ v: 'a' }, { v: 'a' }], { v: 'a' }, 'v'), 2);
  });
}
