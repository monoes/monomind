import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const lodash = require('./lodash.js');
const fp = require('./fp/_baseConvert')(lodash.runInContext(), lodash.runInContext());

const double = (n) => n * 2;
const square = (n) => n * n;
const add = (a, b) => a + b;

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

test('the single-file build exposes transformArgs and no longer overArgs', () => {
  assert.equal(typeof lodash.transformArgs, 'function');
  assert.equal(lodash.overArgs, undefined);
  assert.equal(lodash.transformArgs(add, [double, square])(3, 4), 22);
});

test('chaining and the wrapper prototype carry the new name', () => {
  assert.equal(typeof lodash.prototype.transformArgs, 'function');
  assert.equal(lodash.prototype.overArgs, undefined);
  assert.equal(lodash(add).transformArgs([double, square]).value()(3, 4), 22);
});

test('the per-method module and the function category use the new name', () => {
  assert.equal(require('./transformArgs')(add, [double, square])(3, 4), 22);
  assert.equal(require('./function').transformArgs, require('./transformArgs'));
  assert.equal(require('./function').overArgs, undefined);
  assert.equal(existsSync('overArgs.js'), false);
  assert.throws(() => require('./overArgs'), /Cannot find module/);
});

test('the fp variant is curried under the new name, and useWith still aliases it', () => {
  assert.equal(fp.overArgs, undefined);
  assert.equal(fp.transformArgs(add, [double, square])(3, 4), 22);
  assert.equal(fp.useWith(add, [double, square])(3, 4), 22);
  assert.equal(fp.transformArgs(add)([double])(3, 1), 7);
});

test('the fp per-method files exist under the new name and the alias file still resolves', () => {
  assert.equal(existsSync('fp/overArgs.js'), false);
  assert.equal(typeof require('./fp/transformArgs'), 'function');
  assert.equal(typeof require('./fp/useWith'), 'function');
  assert.equal(require('./fp/transformArgs'), require('./fp/useWith'));
});

test('no unminified file still mentions the old name', () => {
  const left = walk('.').filter(
    (f) => !f.endsWith('.min.js') && f !== 'check.mjs' && /overArgs/.test(readFileSync(f, 'utf8')),
  );
  assert.deepEqual(left, []);
});

test('the rest of the library is unaffected', () => {
  assert.deepEqual(lodash.chunk([1, 2, 3], 2), [[1, 2], [3]]);
  assert.equal(fp.map(double, [1, 2]).join(), '2,4');
  assert.equal(lodash.over([Math.max, Math.min])(1, 2, 3).join(), '3,1');
});
