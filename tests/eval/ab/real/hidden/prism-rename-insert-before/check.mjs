import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const Prism = require('./prism.js');
const load = require('./components/index.js');

const SAMPLES = {
  cpp: 'template <class T> struct A : B { auto f() -> int { return 1 + sizeof(T); } };\nmodule foo;\nR"x(raw)x";',
  csharp: 'class A { int F(int x) => $"v={x}"; [Obsolete] void G() { var y = 1..2; } }',
  coffeescript: '### c ###\nsquare = (x) -> x * x\n`js` + """multi\nline"""',
  crystal: '@[Flags]\nclass A\n  def f(x : Int32) : String\n    "#{x}"\n  end\nend',
  php: '<?php\nfunction f($a) { return "x{$a}"; }\n?>',
  jsx: 'const a = <div className="x">{b}</div>;',
  scss: '@mixin m($a) { color: $a; &:hover { x: y } }',
  markup: '<style>a{b:c}</style><script>let x=1</script>',
  cshtml: '@model Foo\n<p>@Model.Bar</p>',
  typescript: 'interface A<T> { x: T[] } let a: A<number> = { x: [1] };',
};
// sha256 prefixes of the highlighted output of the untouched copy
const EXPECTED = {
  cpp: '0815fe78c329cac7',
  csharp: '2c3fd8fc635333a8',
  coffeescript: 'c44ffd0efd18de2e',
  crystal: 'a6f413947960938f',
  php: 'ad00fbdd809012ba',
  jsx: 'e81c44fb38452cbf',
  scss: 'bfe142440cef32f0',
  markup: 'f322c7352df6d914',
  cshtml: '5b6bb4171bde6e18',
  typescript: 'c1c32464b4967925',
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === 'node_modules'
        ? []
        : walk(join(dir, e.name))
      : [join(dir, e.name)],
  );

test('the helper is exposed as insertTokensBefore only', () => {
  assert.equal(typeof Prism.languages.insertTokensBefore, 'function');
  assert.equal(Prism.languages.insertBefore, undefined);
});

test('insertTokensBefore still inserts in order and returns the new grammar', () => {
  Prism.languages.demo = { a: /a/, c: /c/ };
  const r = Prism.languages.insertTokensBefore('demo', 'c', { b: /b/ });
  assert.deepEqual(Object.keys(Prism.languages.demo), ['a', 'b', 'c']);
  assert.equal(r, Prism.languages.demo);
  delete Prism.languages.demo;
});

test('no file of the copy mentions the old name any more', () => {
  const left = walk('.').filter(
    (f) => f !== 'check.mjs' && /insertBefore/.test(readFileSync(f, 'utf8')),
  );
  assert.deepEqual(left, []);
});

test('every language component loads', () => {
  load();
  assert.equal(
    Object.keys(Prism.languages).filter((k) => typeof Prism.languages[k] === 'object').length,
    400,
  );
});

for (const [lang, code] of Object.entries(SAMPLES)) {
  test(`${lang} highlights exactly as before`, () => {
    load([lang]);
    const out = Prism.highlight(code, Prism.languages[lang], lang);
    assert.equal(createHash('sha256').update(out).digest('hex').slice(0, 16), EXPECTED[lang]);
  });
}
