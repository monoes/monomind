import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { Command, Option } = require('./index.js');

function make(build) {
  const p = new Command('prog').exitOverride();
  const err = [];
  const out = [];
  p.configureOutput({ writeErr: (s) => err.push(s), writeOut: (s) => out.push(s) });
  build(p);
  return { p, err, out };
}

test('deprecated() is chainable and optional-message', () => {
  const o = new Option('--old <v>');
  assert.equal(o.deprecated('use --new'), o);
  assert.ok(new Option('--x').deprecated() instanceof Option);
});

test('using a deprecated option warns through writeErr and still parses', () => {
  const { p, err } = make((p) => {
    p.addOption(new Option('--old <v>', 'the old way').deprecated('use --new'));
    p.option('--new <v>', 'the new way');
  });
  p.parse(['--old', '5'], { from: 'user' });
  assert.equal(p.opts().old, '5');
  assert.deepEqual(err, ["warning: option '--old <v>' is deprecated: use --new\n"]);
});

test('no message: warning has no trailing reason', () => {
  const { p, err } = make((p) => p.addOption(new Option('--gone').deprecated()));
  p.parse(['--gone'], { from: 'user' });
  assert.deepEqual(err, ["warning: option '--gone' is deprecated\n"]);
});

test('env var supplied value also warns', () => {
  process.env.PROG_OLD = 'e';
  try {
    const { p, err } = make((p) =>
      p.addOption(new Option('--old <v>').env('PROG_OLD').deprecated('x')),
    );
    p.parse([], { from: 'user' });
    assert.equal(p.opts().old, 'e');
    assert.equal(err.length, 1);
    assert.match(err[0], /^warning: option '--old <v>' is deprecated: x\n$/);
  } finally {
    delete process.env.PROG_OLD;
  }
});

test('non-deprecated options and unused deprecated options stay silent', () => {
  const { p, err } = make((p) => {
    p.addOption(new Option('--old <v>').deprecated('x'));
    p.option('--fine <v>');
  });
  p.parse(['--fine', '1'], { from: 'user' });
  assert.deepEqual(err, []);
});

test('help marks deprecated options with [deprecated] after the other extra info', () => {
  const { p } = make((p) => {
    p.addOption(new Option('--old <v>', 'the old way').default('a').deprecated('x'));
    p.addOption(new Option('--plain <v>', 'plain one').default('b'));
    p.addOption(new Option('--bare', 'bare one').deprecated());
  });
  const text = p.helpInformation();
  assert.match(text, /the old way \(default: "a"\) \[deprecated\]/);
  assert.match(text, /bare one \[deprecated\]/);
  assert.doesNotMatch(
    text.split('\n').find((l) => l.includes('--plain')),
    /deprecated/,
  );
});
