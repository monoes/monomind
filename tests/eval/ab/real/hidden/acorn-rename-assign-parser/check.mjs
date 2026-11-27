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

test('the method is renamed on the Parser prototype', () => {
  assert.equal(typeof acorn.Parser.prototype.parseAssignExpression, 'function');
  assert.equal(acorn.Parser.prototype.parseMaybeAssign, undefined);
});

test('no source file mentions the old name', () => {
  assert.doesNotMatch(srcText(), /parseMaybeAssign/);
});

test('every internal caller goes through the new name (plugin override sees them)', () => {
  let calls = 0;
  class P extends acorn.Parser {
    parseAssignExpression(...a) {
      calls++;
      return super.parseAssignExpression(...a);
    }
  }
  P.parse(
    'a = b; f(c, d); [e, g] = h; x => y; for (var i = 0; i < 1; i++) {} export default 1;',
    moduleOpts,
  );
  assert.ok(calls >= 10, 'override was called ' + calls + ' times');
});

test('parsing is unchanged', () => {
  assert.equal(
    astHash(corpus, programs),
    'd9efc5adf4ed0e6b613248a57b5addc0d73e6a136bc928a88ba03ca95e23aa23',
  );
});
