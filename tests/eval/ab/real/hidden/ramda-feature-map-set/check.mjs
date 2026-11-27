import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as R from './source/index.js';

test('clone makes an independent deep copy of a Set', () => {
  const inner = { a: [1] };
  const s = new Set([inner, 2, [3]]);
  const c = R.clone(s);
  assert.ok(c instanceof Set);
  assert.notEqual(c, s);
  assert.equal(c.size, 3);
  assert.ok(R.equals(c, s));
  const [ci] = [...c];
  assert.notEqual(ci, inner);
  ci.a.push(2);
  assert.deepEqual(inner.a, [1]);
});

test('clone makes an independent deep copy of a Map, keys and values', () => {
  const k = { id: 1 };
  const m = new Map([
    [k, { v: new Date(0) }],
    ['s', [1, 2]],
  ]);
  const c = R.clone(m);
  assert.ok(c instanceof Map);
  assert.notEqual(c, m);
  assert.equal(c.size, 2);
  const [[ck, cv]] = [...c];
  assert.notEqual(ck, k);
  assert.deepEqual(ck, k);
  assert.notEqual(cv, m.get(k));
  assert.notEqual(cv.v, m.get(k).v);
  assert.equal(cv.v.getTime(), 0);
  c.get('s').push(3);
  assert.deepEqual(m.get('s'), [1, 2]);
});

test('clone keeps circular and shared references inside Maps and Sets', () => {
  const m = new Map();
  m.set('self', m);
  const cm = R.clone(m);
  assert.notEqual(cm, m);
  assert.equal(cm.get('self'), cm);

  const shared = { x: 1 };
  const holder = { a: new Set([shared]), b: new Map([['k', shared]]) };
  const ch = R.clone(holder);
  assert.equal([...ch.a][0], ch.b.get('k'));
  assert.notEqual([...ch.a][0], shared);
});

test('clone of the existing kinds is unchanged', () => {
  const o = { d: new Date(5), r: /x/g, a: [1, { b: 2 }], u: new Uint8Array([1, 2]) };
  const c = R.clone(o);
  assert.deepEqual(c, o);
  assert.notEqual(c.a[1], o.a[1]);
  assert.notEqual(c.u, o.u);
});

test('length reports size for Map and Set and still length for the rest', () => {
  assert.equal(R.length(new Set([1, 2, 2, 3])), 3);
  assert.equal(
    R.length(
      new Map([
        [1, 1],
        [2, 2],
      ]),
    ),
    2,
  );
  assert.equal(R.length(new Set()), 0);
  assert.equal(R.length([1, 2, 3]), 3);
  assert.equal(R.length('abcd'), 4);
  assert.equal(R.length({ length: 7 }), 7);
  assert.ok(Number.isNaN(R.length({ size: 3 })));
  assert.ok(Number.isNaN(R.length(null)));
  assert.ok(Number.isNaN(R.length(new WeakSet())));
});

test('includes looks through a Set, and through the values of a Map, with R.equals semantics', () => {
  assert.equal(R.includes(2, new Set([1, 2])), true);
  assert.equal(R.includes(3, new Set([1, 2])), false);
  assert.equal(R.includes({ a: 1 }, new Set([{ a: 1 }])), true);
  assert.equal(R.includes([1], new Set([[1], [2]])), true);
  assert.equal(R.includes(NaN, new Set([NaN])), true);
  assert.equal(R.includes(1, new Map([['x', 1]])), true);
  assert.equal(R.includes('x', new Map([['x', 1]])), false);
  assert.equal(R.includes({ n: 1 }, new Map([['k', { n: 1 }]])), true);
  assert.equal(R.includes(2)(new Set([2])), true);
});

test('includes on arrays and strings is unchanged', () => {
  assert.equal(R.includes(3, [1, 2, 3]), true);
  assert.equal(R.includes([42], [[42]]), true);
  assert.equal(R.includes('ba', 'banana'), true);
  assert.equal(R.includes('z', 'banana'), false);
  assert.equal(R.includes(NaN, [NaN]), true);
});
