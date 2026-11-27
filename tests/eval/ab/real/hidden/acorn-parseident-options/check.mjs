import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as acorn from './acorn/src/index.js';

const corpus = [
  'a = b = c ? d : e',
  'x => y => x + y',
  'async (a, b = 1, ...rest) => { await a; }',
  'function* g(a) { const x = yield a; yield* g(x); }',
  'async function f() { for await (const x of y) { await x } }',
  'var {a, b: [c, d = 5], ...e} = obj; [a, b] = [b, a];',
  '({a = 1, b: {c}} = {}) => 0',
  'class A extends B { #p = 1; static s = 2; get x() { return this.#p } static { A.s++ } constructor() { super(); } }',
  'label: for (let i = 0, j = 10; i < j; i++, j--) { if (i % 2) continue label; else break label }',
  'const t = `a${b}c${`d${e}`}`; tag`x${1}y`;',
  'a?.b?.[c]?.(d) ?? e; x ||= y; x &&= z; x ??= w; 2 ** 3 ** 2',
  'switch (a) { case 1: let z = 2; break; default: { var q } }',
  'try { throw new Error("x") } catch ({message}) { log(message) } finally { done() }',
  'function h() { return new.target } import("m").then(m => m.default)',
  'if (a) b; else if (c) d; else { e }; do x++; while (x < 5)',
  'let o = { get a() { return 1 }, set a(v) {}, async *m() {}, [k + 1]: 2, "s": 3, 4: 5, ...spread }',
];
const programs = [
  'import d, {a as b, c} from "m"; export default class {}; export {b as e}; export * as ns from "n";',
  'import.meta.url; export const v = 1; export function f() {}; export async function* ag() {}',
];
const scriptOpts = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
};
const moduleOpts = { ecmaVersion: 'latest', sourceType: 'module' };
const astHash = (cs, ps) => {
  const h = createHash('sha256');
  for (const s of cs) h.update(JSON.stringify(acorn.parse(s, scriptOpts)));
  for (const s of ps) h.update(JSON.stringify(acorn.parse(s, moduleOpts)));
  return h.digest('hex');
};
const srcText = () =>
  readdirSync('acorn/src')
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync('acorn/src/' + f, 'utf8'))
    .join('\n');

const extra = [
  'a.if = b.class + c.default',
  'o = { if: 1, class: 2, get default() { return 3 } }',
  'x.y.z.await',
  'label: while (1) { break label }',
];
const extraModule = [
  'let x, y; export { x as default, y as if }; import { default as q, if as r } from "m"',
];

function recordArgs(fn) {
  const proto = acorn.Parser.prototype;
  const orig = proto.parseIdent;
  const seen = [];
  proto.parseIdent = function (...args) {
    seen.push(args);
    return orig.apply(this, args);
  };
  try {
    fn();
  } finally {
    proto.parseIdent = orig;
  }
  return seen;
}

test('parseIdent never receives a boolean any more', () => {
  const seen = recordArgs(() => astHash([...corpus, ...extra], [...programs, ...extraModule]));
  assert.ok(seen.length > 20, 'parseIdent was exercised');
  for (const args of seen) {
    assert.ok(args.length <= 1);
    assert.ok(
      args[0] === undefined || (typeof args[0] === 'object' && args[0] !== null),
      'got ' + JSON.stringify(args),
    );
  }
  assert.ok(
    seen.some((a) => a[0] && a[0].liberal === true),
    'a liberal call exists',
  );
  assert.ok(seen.every((a) => a[0] === undefined || typeof a[0].liberal === 'boolean'));
});

test('parsing is unchanged', () => {
  assert.equal(
    astHash([...corpus, ...extra], [...programs, ...extraModule]),
    'cdc4e2d1d7c8ec096ccff6ebc580620f4ad95587b9544c3b2dfe0ca2ffc0c331',
  );
});

test('liberal identifiers still depend on allowReserved', () => {
  assert.doesNotThrow(() => acorn.parse('a.if', { ecmaVersion: 2020 }));
  assert.throws(
    () => acorn.parse('a.if', { ecmaVersion: 2020, allowReserved: 'never' }),
    SyntaxError,
  );
  assert.throws(
    () => acorn.parse('({ if: 1 })', { ecmaVersion: 2020, allowReserved: 'never' }),
    SyntaxError,
  );
});

test('subclasses can call the new form directly', () => {
  class P extends acorn.Parser {
    parseExprAtom(...a) {
      if (this.type === acorn.tokTypes._if) return this.parseIdent({ liberal: true });
      return super.parseExprAtom(...a);
    }
  }
  const ast = P.parse('x = if', { ecmaVersion: 2020 });
  assert.equal(ast.body[0].expression.right.name, 'if');
});
