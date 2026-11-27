import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { Command, Option } = require('./index.js');

const capture = (program) => {
  let out = '';
  program.configureOutput({ writeOut: (s) => (out += s), writeErr: (s) => (out += s) });
  return () => out;
};

test('hideHelp sets hiddenFromHelp and the old property is gone', () => {
  const o = new Option('-x, --xray').hideHelp();
  assert.equal(o.hiddenFromHelp, true);
  assert.equal(new Option('-y').hiddenFromHelp, false);
  assert.equal('hidden' in o, false);
  assert.equal(typeof o.hideHelp, 'function');
});

test('help output still hides hidden options and shows visible ones', () => {
  const p = new Command('prog');
  p.addOption(new Option('-s, --secret').hideHelp());
  p.option('-v, --visible', 'shown');
  const text = p.helpInformation();
  assert.match(text, /--visible/);
  assert.doesNotMatch(text, /--secret/);
  const names = p
    .createHelp()
    .visibleOptions(p)
    .map((o) => o.long);
  assert.ok(!names.includes('--secret'));
});

test('{ hidden: true } for subcommands is public API and still works', () => {
  const p = new Command('prog');
  p.command('open', { hidden: true });
  p.command('shown');
  p.addCommand(new Command('legacy'), { hidden: true });
  const text = p.helpInformation();
  assert.match(text, /shown/);
  assert.doesNotMatch(text, /open/);
  assert.doesNotMatch(text, /legacy/);
});

test('parsing with a hidden option still works', () => {
  const p = new Command('prog').exitOverride();
  p.addOption(new Option('-s, --secret <v>').hideHelp());
  p.parse(['--secret', 'k'], { from: 'user' });
  assert.equal(p.opts().secret, 'k');
});

test('lib no longer reads or writes the old Option property', () => {
  for (const f of readdirSync('lib')) {
    const src = readFileSync(`lib/${f}`, 'utf8');
    assert.doesNotMatch(src, /this\.hidden\b/, `${f} still has this.hidden`);
    assert.doesNotMatch(
      src,
      /\b(option|helpOption|opt)\.hidden\b/,
      `${f} still reads option.hidden`,
    );
  }
});
