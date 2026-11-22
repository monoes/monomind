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

const bad = (code, opts = {}) => assert.throws(() => acorn.parse(code, { ecmaVersion: 'latest', ...opts }), /already been declared/, code);
const ok = (code, opts = {}) => assert.doesNotThrow(() => acorn.parse(code, { ecmaVersion: 'latest', ...opts }), code);

test('const conflicts with every other declaration kind in the same scope', () => {
  bad('const a = 1; var a;');
  bad('var a; const a = 1;');
  bad('const a = 1; let a = 2;');
  bad('const a = 1; function a() {}', { sourceType: 'module' });
  bad('const a = 1, b = 2, a = 3;');
  bad('{ const a = 1; var a; }');
});

test('let and var behave as before', () => {
  bad('let a; var a;');
  bad('var a; let a;');
  bad('let a; let a;');
  ok('var a; var a;');
  ok('var a; function a() {}');
});

test('shadowing in other scopes stays legal', () => {
  ok('const a = 1; { const a = 2; } function f() { var a; const b = 1; }');
  ok('const a = 1; { let a = 2; }');
  ok('for (const a of x) { const b = a; } for (const a of y) {}');
  ok('try {} catch (e) { const f = 1; }');
});
