import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as R from './source/index.js';
import _dispatchable from './source/internal/_dispatchable.js';

const L = [3, 1, 1, 4, 1, 5, 9, 2, 6];
const gt2 = (x) => x > 2;
const inc = (x) => x + 1;
const into = (xf, list = L) => R.into([], xf, list);
const point = { type: 'P' };

// Every public function built on _dispatchable, through the array path and the transducer path.
export const CASES = {
  any: () => [
    R.any(gt2, L),
    into(R.compose(R.map(inc)), [1]),
    R.transduce(R.map(R.identity), (a, x) => a + x, 0, L),
  ],
  all: () => [R.all(gt2, L), R.all(R.lt(0), L)],
  aperture: () => [R.aperture(3, L), into(R.aperture(2))],
  drop: () => [R.drop(3, L), into(R.drop(3)), R.drop(2, 'abcd')],
  dropLast: () => [R.dropLast(3, L), into(R.dropLast(3))],
  dropWhile: () => [R.dropWhile(R.lt(2), L), into(R.dropWhile(gt2))],
  dropLastWhile: () => [R.dropLastWhile(gt2, L), into(R.dropLastWhile(gt2))],
  dropRepeats: () => [R.dropRepeats(L), into(R.dropRepeats())],
  dropRepeatsWith: () => [
    R.dropRepeatsWith(R.eqBy(Math.floor), [1, 1.5, 2, 2.2, 3]),
    into(R.dropRepeatsWith(R.eqBy(Math.floor))),
  ],
  dropRepeatsBy: () => [
    R.dropRepeatsBy(Math.abs, [1, -1, 2, -2, 3]),
    into(R.dropRepeatsBy(Math.abs), [1, -1, 2, -2, 3]),
  ],
  find: () => [R.find(gt2, L), into(R.find(gt2))],
  findIndex: () => [R.findIndex(gt2, L), into(R.findIndex(gt2))],
  findLast: () => [R.findLast(gt2, L), into(R.findLast(gt2))],
  findLastIndex: () => [R.findLastIndex(gt2, L), into(R.findLastIndex(gt2))],
  map: () => [
    R.map(inc, L),
    into(R.map(inc)),
    R.map(inc, { a: 1, b: 2 }),
    R.map(inc, (x) => x * 2)(3),
  ],
  filter: () => [R.filter(gt2, L), into(R.filter(gt2)), R.filter(gt2, { a: 1, b: 5 })],
  reject: () => [R.reject(gt2, L), into(R.reject(gt2))],
  take: () => [R.take(3, L), into(R.take(3)), R.take(2, 'abcd')],
  takeWhile: () => [R.takeWhile(gt2, L), into(R.takeWhile(R.lt(0)))],
  uniqBy: () => [R.uniqBy(Math.abs, [1, -1, 2, -2]), into(R.uniqBy(R.identity))],
  uniqWith: () => [R.uniqWith(R.eqBy(Math.abs), [1, -1, 2, -2]), into(R.uniqWith(R.equals))],
  tap: () => {
    const seen = [];
    return [R.tap((x) => seen.push(x), 5), seen, into(R.tap(R.identity))];
  },
  scan: () => [R.scan(R.add, 0, [1, 2, 3]), into(R.scan(R.add, 0), [1, 2, 3])],
  reduceBy: () => [
    R.reduceBy(
      (a, x) => a + x,
      0,
      (x) => x % 2,
      L,
    ),
    R.transduce(R.map(inc), (a, x) => a + x, 0, L),
  ],
  chain: () => [
    R.chain((x) => [x, x], [1, 2]),
    into(
      R.chain((x) => [x, x]),
      [1, 2],
    ),
    R.chain(
      (f) => (g) => f + g,
      (x) => x * 2,
    )(3),
  ],
  unnest: () => [R.unnest([[1], [2, [3]]])],
  promap: () => [R.promap(inc, inc, (x) => x * 2)(3)],
  collectBy: () => [R.collectBy(R.prop('t'), [{ t: 1 }, { t: 2 }, { t: 1 }])],
  groupBy: () => [R.groupBy((x) => x % 3, L)],
  pluck: () => [R.pluck('a', [{ a: 1 }, { a: 2 }])],
  sequence: () => [R.sequence(R.of(Array), [[1, 2], [3]])],
  innerJoin: () => [R.innerJoin((a, b) => a === b, L, [1, 9])],
  without: () => [R.without([1, 9], L)],
};

// custom list-like values reach their own methods first
test('an object with the method name is dispatched to', () => {
  const o = {
    take: (n) => `took ${n}`,
    find: (f) => `found ${f.name}`,
    drop: (n) => `dropped ${n}`,
    any: () => 'anyd',
  };
  assert.equal(R.take(2, o), 'took 2');
  assert.equal(R.drop(1, o), 'dropped 1');
  assert.equal(
    R.any(function pred() {}, o),
    'anyd',
  );
  assert.equal(
    R.find(function pred() {}, o),
    'found pred',
  );
  assert.equal(R.map(inc, { map: (f) => f(1) }), 2);
  assert.equal(R.filter(inc, { filter: (f) => f(1) }), 2);
  assert.equal(R.filter(inc, { 'fantasy-land/filter': (f) => `fl ${f(1)}` }), 'fl 2');
});

test('the helper takes the default implementation first, then method names, then the transducer factory', () => {
  const calls = [];
  const xf = (n) => (next) => ({
    '@@transducer/init': () => next['@@transducer/init'](),
    '@@transducer/result': (r) => next['@@transducer/result'](r),
    '@@transducer/step': (r, x) => (calls.push(['xf', n, x]), next['@@transducer/step'](r, x)),
  });
  const fn = (n, list) => list.map((x) => x + n);
  const d = _dispatchable(fn, ['viaMethod'], xf);
  assert.deepEqual(d(1, [1, 2]), [2, 3]);
  assert.equal(d(1, { viaMethod: (n) => `method ${n}` }), 'method 1');
  const sink = {
    '@@transducer/init': () => [],
    '@@transducer/result': (r) => r,
    '@@transducer/step': (r, x) => (r.push(x), r),
  };
  const t = d(7, sink);
  assert.deepEqual(
    t['@@transducer/step'](t['@@transducer/step'](t['@@transducer/init'](), 1), 2),
    [1, 2],
  );
  assert.deepEqual(calls, [
    ['xf', 7, 1],
    ['xf', 7, 2],
  ]);
  assert.equal(_dispatchable(() => 'no args', [], null)(), 'no args');
  assert.equal(
    _dispatchable(
      function () {
        return this.tag;
      },
      [],
      null,
    ).call({ tag: 'ctx' }, point),
    'ctx',
  );
});

test('every dispatching public function behaves as before', () => {
  const out = Object.fromEntries(Object.entries(CASES).map(([k, f]) => [k, f()]));
  assert.equal(JSON.stringify(out), EXPECTED);
});

const EXPECTED =
  '{"any":[true,[2],32],"all":[false,true],"aperture":[[[3,1,1],[1,1,4],[1,4,1],[4,1,5],[1,5,9],[5,9,2],[9,2,6]],[[3,1],[1,1],[1,4],[4,1],[1,5],[5,9],[9,2],[2,6]]],"drop":[[4,1,5,9,2,6],[4,1,5,9,2,6],"cd"],"dropLast":[[3,1,1,4,1,5],[3,1,1,4,1,5]],"dropWhile":[[1,1,4,1,5,9,2,6],[1,1,4,1,5,9,2,6]],"dropLastWhile":[[3,1,1,4,1,5,9,2],[3,1,1,4,1,5,9,2]],"dropRepeats":[[3,1,4,1,5,9,2,6],[3,1,4,1,5,9,2,6]],"dropRepeatsWith":[[1,2,3],[3,1,4,1,5,9,2,6]],"dropRepeatsBy":[[1,2,3],[1,2,3]],"find":[3,[3]],"findIndex":[0,[0]],"findLast":[6,[6]],"findLastIndex":[8,[8]],"map":[[4,2,2,5,2,6,10,3,7],[4,2,2,5,2,6,10,3,7],{"a":2,"b":3},7],"filter":[[3,4,5,9,6],[3,4,5,9,6],{"b":5}],"reject":[[1,1,1,2],[1,1,1,2]],"take":[[3,1,1],[3,1,1],"ab"],"takeWhile":[[3],[3,1,1,4,1,5,9,2,6]],"uniqBy":[[1,2],[3,1,4,5,9,2,6]],"uniqWith":[[1,2],[3,1,4,5,9,2,6]],"tap":[5,[5],[3,1,1,4,1,5,9,2,6]],"scan":[[0,1,3,6],[0,1,3,6]],"reduceBy":[{"0":12,"1":20},41],"chain":[[1,1,2,2],[1,1,2,2],9],"unnest":[[1,2,[3]]],"promap":[9],"collectBy":[[[{"t":1},{"t":1}],[{"t":2}]]],"groupBy":[{"0":[3,9,6],"1":[1,1,4,1],"2":[5,2]}],"pluck":[[1,2]],"sequence":[[[1,3],[2,3]]],"innerJoin":[[1,1,1,9]],"without":[[3,4,5,2,6]]}';
