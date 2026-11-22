import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import * as acorn from './acorn/src/index.js';

const corpus = [
  "a = b = c ? d : e",
  "x => y => x + y",
  "async (a, b = 1, ...rest) => { await a; }",
  "function* g(a) { const x = yield a; yield* g(x); }",
  "async function f() { for await (const x of y) { await x } }",
  "var {a, b: [c, d = 5], ...e} = obj; [a, b] = [b, a];",
  "({a = 1, b: {c}} = {}) => 0",
  "class A extends B { #p = 1; static s = 2; get x() { return this.#p } static { A.s++ } constructor() { super(); } }",
  "label: for (let i = 0, j = 10; i < j; i++, j--) { if (i % 2) continue label; else break label }",
  "const t = `a${b}c${`d${e}`}`; tag`x${1}y`;",
  "a?.b?.[c]?.(d) ?? e; x ||= y; x &&= z; x ??= w; 2 ** 3 ** 2",
  "switch (a) { case 1: let z = 2; break; default: { var q } }",
  "try { throw new Error(\"x\") } catch ({message}) { log(message) } finally { done() }",
  "function h() { return new.target } import(\"m\").then(m => m.default)",
  "if (a) b; else if (c) d; else { e }; do x++; while (x < 5)",
  "let o = { get a() { return 1 }, set a(v) {}, async *m() {}, [k + 1]: 2, \"s\": 3, 4: 5, ...spread }"
];
const programs = [
  "import d, {a as b, c} from \"m\"; export default class {}; export {b as e}; export * as ns from \"n\";",
  "import.meta.url; export const v = 1; export function f() {}; export async function* ag() {}"
];
const scriptOpts = { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
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

const depthOf = (code, max, extra = {}) => acorn.parse(code, { ecmaVersion: 'latest', maxNestingDepth: max, ...extra });

test('code within the limit parses', () => {
  assert.equal(depthOf('[[[1]]]', 3).body.length, 1);
  assert.equal(depthOf('f(g(h(1)))', 3).body.length, 1);
  assert.equal(depthOf('({a: {b: {c: 1}}})', 4).body.length, 1);
});

test('exceeding the limit is a SyntaxError at the offending opener', () => {
  let err;
  try {
    depthOf('[[[[1]]]]', 3);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof SyntaxError);
  assert.match(err.message, /Maximum nesting depth of 3 exceeded/);
  assert.equal(err.pos, 3);
  assert.deepEqual({ line: err.loc.line, column: err.loc.column }, { line: 1, column: 3 });
});

test('( [ { and template interpolation all count', () => {
  assert.throws(() => depthOf('(((1)))', 2), /nesting depth of 2/);
  assert.throws(() => depthOf('x = {a: {b: 1}}', 1), /nesting depth of 1/);
  assert.throws(() => depthOf('if (a) { { { b } } }', 2), /nesting depth of 2/);
  assert.throws(() => depthOf('`${`${`${x}`}`}`', 2), /nesting depth of 2/);
  assert.equal(depthOf('`${`${x}`}`', 2).body.length, 1);
});

test('closing brackets release depth', () => {
  assert.equal(depthOf('[1]; [2]; [3]; (a); {b} f(g)', 1).body.length, 6);
  assert.equal(depthOf('function f(a, b) { return [a, b] } f(1, 2); f(3, 4);', 3).body.length, 3);
});

test('without the option nothing is limited, and the default parse is unchanged', () => {
  const deep = '['.repeat(500) + ']'.repeat(500);
  assert.equal(acorn.parse(deep, { ecmaVersion: 'latest' }).body.length, 1);
  assert.equal(acorn.parse(deep, { ecmaVersion: 'latest', maxNestingDepth: null }).body.length, 1);
  assert.equal(acorn.defaultOptions.maxNestingDepth, null);
});

test('a realistic program parses under a generous limit', () => {
  for (const s of corpus) depthOf(s, 40, { allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
});
