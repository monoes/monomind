import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { Command } = require('./index.js');

function errorFor(args, build) {
  const p = new Command('prog').exitOverride();
  let err = '';
  p.configureOutput({ writeErr: (s) => (err += s), writeOut: () => {} });
  build(p);
  assert.throws(() => p.parse(args, { from: 'user' }));
  return err;
}

test('a transposed option name suggests only the intended option', () => {
  const err = errorFor(['--prot'], (p) => p.option('--port <n>').option('--post <b>'));
  assert.match(err, /unknown option '--prot'/);
  assert.match(err, /\(Did you mean --port\?\)/);
  assert.doesNotMatch(err, /one of/);
});

test('a transposed command name suggests only the intended command', () => {
  const err = errorFor(['strat'], (p) => {
    p.command('start');
    p.command('strip');
  });
  assert.match(err, /unknown command 'strat'/);
  assert.match(err, /Did you mean start\?/);
});

test('ordinary single-edit typos still suggest', () => {
  const err = errorFor(['--verbos'], (p) => p.option('--verbose'));
  assert.match(err, /\(Did you mean --verbose\?\)/);
});

test('equally close candidates are still listed together', () => {
  const err = errorFor(['--fo'], (p) => p.option('--foa').option('--fob'));
  assert.match(err, /Did you mean one of --foa, --fob\?/);
});
