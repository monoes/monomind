import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import typeTester from './modules/_typeTester.js';
import _ from './modules/index-all.js';

const modules = readdirSync('modules').filter((f) => f.endsWith('.js'));

test('the helper moved to _typeTester.js and the old file is gone', () => {
  assert.equal(existsSync('modules/_typeTester.js'), true);
  assert.equal(existsSync('modules/_tagTester.js'), false);
  assert.equal(typeof typeTester, 'function');
  assert.equal(typeTester('Number')(3), true);
  assert.equal(typeTester('Number')('3'), false);
  assert.equal(typeTester('Date')(new Date()), true);
});

test('the old name appears nowhere in the sources', () => {
  for (const f of modules)
    assert.doesNotMatch(readFileSync(join('modules', f), 'utf8'), /tagTester/, f);
});

test('every relative import in every module still resolves', () => {
  let checked = 0;
  for (const f of modules) {
    const src = readFileSync(join('modules', f), 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s+'(\.[^']+)'/g)) {
      assert.equal(existsSync(join('modules', m[1])), true, `${f} imports missing ${m[1]}`);
      checked++;
    }
  }
  assert.ok(checked > 300);
});

test('importers use the new module', () => {
  const users = modules.filter((f) =>
    /from '\.\/_typeTester\.js'/.test(readFileSync(join('modules', f), 'utf8')),
  );
  assert.ok(users.length >= 16, 'only ' + users.length + ' modules import it');
  assert.ok(
    users.includes('isString.js') && users.includes('isDate.js') && users.includes('isMap.js'),
  );
});

test('type predicates behave as before', () => {
  assert.equal(_.isString('x'), true);
  assert.equal(_.isString(1), false);
  assert.equal(_.isNumber(NaN), true);
  assert.equal(_.isDate(new Date()), true);
  assert.equal(_.isRegExp(/x/), true);
  assert.equal(_.isError(new TypeError('x')), true);
  assert.equal(_.isSymbol(Symbol('s')), true);
  assert.equal(_.isMap(new Map()), true);
  assert.equal(_.isSet(new Set()), true);
  assert.equal(_.isWeakMap(new WeakMap()), true);
  assert.equal(_.isArrayBuffer(new ArrayBuffer(1)), true);
  assert.equal(
    _.isArguments(
      (function () {
        return arguments;
      })(1),
    ),
    true,
  );
  assert.equal(
    _.isFunction(() => {}),
    true,
  );
  assert.equal(
    _.isFunction(async () => {}),
    true,
  );
  assert.equal(_.isEqual({ a: [1, new Date(0)] }, { a: [1, new Date(0)] }), true);
});
