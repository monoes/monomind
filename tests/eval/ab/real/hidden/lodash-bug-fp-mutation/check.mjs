import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const lodash = require('./lodash.js');
// fp.js loads the minified bundle, so the check builds the same converted object from the readable build.
const fp = require('./fp/_baseConvert')(lodash.runInContext(), lodash.runInContext());

const make = () => ({ a: { b: { c: 1, d: [1, 2] }, e: 2 }, f: { g: 3 }, h: 4 });
const frozen = (o) => JSON.stringify(o);

test('fp.set on a nested path leaves its input untouched and shares what it did not touch', () => {
  const o = make();
  const snapshot = frozen(o);
  const r = fp.set('a.b.c', 9, o);
  assert.equal(frozen(o), snapshot);
  assert.equal(r.a.b.c, 9);
  assert.notEqual(r.a, o.a);
  assert.notEqual(r.a.b, o.a.b);
  assert.equal(r.f, o.f);
});

test('fp.update, fp.unset, fp.assoc and fp.dissocPath do not mutate nested inputs', () => {
  for (const run of [
    (o) => fp.update('a.b.c', (x) => x + 1, o),
    (o) => fp.unset('a.b.c', o),
    (o) => fp.assoc('a.e', 5, o),
    (o) => fp.dissocPath('a.b', o),
    (o) => fp.setWith(Object, 'a.b.d.0', 7, o),
    (o) => fp.update('a.b.d', (d) => d.concat(3), o),
  ]) {
    const o = make();
    const snapshot = frozen(o);
    run(o);
    assert.equal(frozen(o), snapshot);
  }
});

test('the results are still correct', () => {
  const o = make();
  assert.deepEqual(fp.update('a.b.c', (x) => x + 1, o).a.b, { c: 2, d: [1, 2] });
  assert.deepEqual(fp.unset('a.b.c', o).a.b, { d: [1, 2] });
  assert.equal(fp.assoc('a.e', 5, o).a.e, 5);
  assert.deepEqual(Object.keys(fp.dissocPath('a.b', o).a), ['e']);
  assert.deepEqual(fp.set('x.y.z', 1, {}), { x: { y: { z: 1 } } });
});

test('top-level and function-valued paths behave', () => {
  const o = { fn: () => 1, k: 1 };
  assert.equal(fp.set('k', 2, o).k, 2);
  assert.equal(o.k, 1);
  assert.equal(fp.set('fn.x', 2, o).fn.x, 2);
});

test('the fp wrappers for lodash.js itself are not required to mutate either', () => {
  const o = make();
  fp.merge(o, { a: { b: { c: 5 } } });
  assert.equal(o.a.b.c, 1);
});
