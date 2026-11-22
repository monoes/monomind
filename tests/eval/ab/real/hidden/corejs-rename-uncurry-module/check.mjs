import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const P = 'packages/core-js';

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

test('the helper lives under the new module name and still uncurries', () => {
  assert.equal(existsSync(`${P}/internals/function-uncurry-this.js`), false);
  assert.equal(existsSync(`${P}/internals/function-uncurry-receiver.js`), true);
  const uncurry = require(`./${P}/internals/function-uncurry-receiver`);
  assert.equal(uncurry(Array.prototype.join)(['a', 'b'], '-'), 'a-b');
  assert.equal(uncurry(String.prototype.slice)('hello', 1, 3), 'el');
});

test('the two sibling modules keep their names and keep working', () => {
  assert.equal(existsSync(`${P}/internals/function-uncurry-this-accessor.js`), true);
  assert.equal(existsSync(`${P}/internals/function-uncurry-this-clause.js`), true);
  assert.equal(existsSync(`${P}/internals/function-uncurry-receiver-accessor.js`), false);
  assert.equal(existsSync(`${P}/internals/function-uncurry-receiver-clause.js`), false);
  const clause = require(`./${P}/internals/function-uncurry-this-clause`);
  assert.equal(clause(Array.prototype.join)(['x', 'y'], '+'), 'x+y');
  const accessor = require(`./${P}/internals/function-uncurry-this-accessor`);
  assert.equal(accessor(Set.prototype, 'size', 'get')(new Set([1, 2])), 2);
});

test('nothing still requires the old module name', () => {
  const stale = walk('.').filter(
    (f) => f !== 'check.mjs' && /function-uncurry-this(?=['"`.])/.test(readFileSync(f, 'utf8')),
  );
  assert.deepEqual(stale, []);
});

test('every module and entry point still loads', () => {
  const failed = [];
  let loaded = 0;
  for (const dir of ['internals', 'modules', 'es', 'stable', 'actual', 'full', 'proposals', 'stage', 'web']) {
    for (const f of walk(`${P}/${dir}`).filter((p) => p.endsWith('.js'))) {
      try {
        require(`./${f}`);
        loaded++;
      } catch (e) {
        failed.push(f);
      }
    }
  }
  // actual/index.js needs the generated stable/index.js, which is not part of the repository
  assert.deepEqual(failed, [`${P}/actual/index.js`]);
  assert.ok(loaded > 2700);
});

test('polyfills that depend on the helper still behave', () => {
  require(`./${P}/stable/array/at`);
  assert.equal([1, 2, 3].at(-1), 3);
  const flatMap = require(`./${P}/es/array/flat-map`);
  assert.equal(typeof flatMap, 'function');
  assert.equal(require(`./${P}/es/string/pad-start`)('7', 3, '0'), '007');
});
