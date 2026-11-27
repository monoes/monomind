import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const P = 'packages/core-js';

// Run a snippet in a fresh process, so one entry point cannot hide that another one does not install Math.lerp.
const fresh = (code) => execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }).trim();

test('the implementation interpolates and propagates NaN', () => {
  const lerp = require(`./${P}/internals/math-lerp`);
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.equal(lerp(5, 5, 0.3), 5);
  assert.equal(lerp(10, 0, 1), 0);
  assert.equal(lerp('2', '4', '0.5'), 3);
  assert.equal(lerp(0, 10, 2), 20);
  assert.ok(Number.isNaN(lerp(NaN, 1, 0.5)));
  assert.ok(Number.isNaN(lerp(0, undefined, 0.5)));
  assert.ok(Number.isNaN(lerp(0, 1, NaN)));
});

test('the module installs Math.lerp as a non-enumerable function of length 3', () => {
  assert.ok(existsSync(`${P}/modules/esnext.math.lerp.js`));
  const out = fresh(`
    delete Math.lerp;
    require('./${P}/modules/esnext.math.lerp');
    const d = Object.getOwnPropertyDescriptor(Math, 'lerp');
    console.log(JSON.stringify([typeof Math.lerp, Math.lerp.length, Math.lerp.name, d.enumerable, d.writable, Math.lerp(0, 8, 0.5)]));
  `);
  assert.equal(out, JSON.stringify(['function', 3, 'lerp', false, true, 4]));
});

test('the standalone entry point exports the function and installs it on the path', () => {
  const out = fresh(`
    const lerp = require('./${P}/full/math/lerp');
    console.log(JSON.stringify([typeof lerp, lerp(1, 3, 0.5), lerp === require('./${P}/internals/path').Math.lerp]));
  `);
  assert.equal(out, JSON.stringify(['function', 2, true]));
});

test('the full Math entry point carries it next to scale and clamp', () => {
  const out = fresh(`
    const m = require('./${P}/full/math');
    console.log(JSON.stringify([typeof m.lerp, typeof m.scale, typeof m.clamp, m.lerp(0, 4, 0.5)]));
  `);
  assert.equal(out, JSON.stringify(['function', 'function', 'function', 2]));
});

test('the math-extensions proposal entry and the stage-1 bundle install it globally', () => {
  assert.equal(
    fresh(
      `delete Math.lerp; require('./${P}/proposals/math-extensions'); console.log(typeof Math.lerp)`,
    ),
    'function',
  );
  assert.equal(
    fresh(
      `delete Math.lerp; require('./${P}/stage/1'); console.log(typeof Math.lerp, Math.lerp(2, 4, 0.5))`,
    ),
    'function 3',
  );
});

test('the entry points that must not carry a proposal do not', () => {
  assert.equal(
    fresh(`delete Math.lerp; require('./${P}/es/math/trunc'); console.log(typeof Math.lerp)`),
    'undefined',
  );
  assert.equal(
    fresh(`delete Math.lerp; require('./${P}/stable/math/sign'); console.log(typeof Math.lerp)`),
    'undefined',
  );
});

test('the existing math extensions still work', () => {
  assert.equal(
    fresh(
      `console.log(require('./${P}/full/math/scale')(5, 0, 10, 0, 100), require('./${P}/full/math/clamp')(5, 0, 2))`,
    ),
    '50 2',
  );
});
