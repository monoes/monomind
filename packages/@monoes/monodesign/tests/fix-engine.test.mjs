/**
 * Auto-fix engine tests: per-fixer fixture pairs (broken -> expected),
 * fix-loop integration (detect -> fix -> re-detect), --dry-run safety,
 * idempotency (second pass = zero edits), and filter-pipeline honor
 * (inline ignores, --rule).
 *
 * Usage: node --test tests/fix-engine.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXERS, getFixer } from '../cli/engine/fix/fixers.mjs';
import { applyEdits, runFix, unifiedDiff } from '../cli/engine/fix/index.mjs';
import { detectHtml } from '../cli/engine/engines/static-html/detect-html.mjs';
import { detectText } from '../cli/engine/engines/regex/detect-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'fixes');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

function applyFixer(ruleId, content, ext) {
  const fixer = getFixer(ruleId);
  assert.ok(fixer, `expected a fixer for ${ruleId}`);
  return applyEdits(content, fixer.fix(content, ext)).content;
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'monodesign-fix-'));
}

// ---------------------------------------------------------------------------
// Per-fixer fixture pairs
// ---------------------------------------------------------------------------

const PAIRS = [
  { rule: 'tight-leading', ext: '.css' },
  { rule: 'tiny-text', ext: '.css' },
  { rule: 'justified-text', ext: '.css' },
  { rule: 'wide-tracking', ext: '.css' },
  { rule: 'extreme-negative-tracking', ext: '.css' },
  { rule: 'layout-transition', ext: '.css' },
  { rule: 'all-caps-body', ext: '.css' },
  { rule: 'skipped-heading', ext: '.html' },
];

describe('fixers — fixture pairs (broken -> expected)', () => {
  for (const { rule, ext } of PAIRS) {
    it(`${rule}: rewrites broken fixture to expected output`, () => {
      const broken = readFixture(`${rule}.broken${ext}`);
      const expected = readFixture(`${rule}.fixed${ext}`);
      assert.equal(applyFixer(rule, broken, ext), expected);
    });

    it(`${rule}: is idempotent (fixed fixture produces zero edits)`, () => {
      const fixed = readFixture(`${rule}.fixed${ext}`);
      const edits = getFixer(rule).fix(fixed, ext);
      assert.equal(edits.length, 0, `expected no edits, got: ${edits.map(e => e.note).join('; ')}`);
    });
  }

  it('broken-image deliberately has no fixer', () => {
    assert.equal(getFixer('broken-image'), null);
  });
});

// ---------------------------------------------------------------------------
// Fix loop integration
// ---------------------------------------------------------------------------

const FIXABLE_IN_MULTI = [
  'tight-leading', 'tiny-text', 'justified-text', 'wide-tracking',
  'all-caps-body', 'layout-transition', 'skipped-heading',
];

describe('runFix — fix loop', () => {
  it('multi-issue file: fixable findings resolved, re-detect confirms, unfixable skipped', async () => {
    const tmp = makeTmpDir();
    const file = path.join(tmp, 'page.html');
    fs.copyFileSync(path.join(FIXTURES, 'multi-issue.broken.html'), file);

    // Sanity: the broken fixture actually triggers the fixable rules.
    const before = await detectHtml(file, {});
    for (const rule of FIXABLE_IN_MULTI) {
      assert.ok(before.some(f => f.antipattern === rule), `expected ${rule} in pre-fix findings`);
    }
    assert.ok(before.some(f => f.antipattern === 'broken-image'));

    const report = await runFix([file], { cwd: tmp });
    assert.equal(report.dryRun, false);
    assert.deepEqual(report.filesChanged, [file]);
    assert.equal(report.remaining.length, 0,
      `expected no remaining findings, got: ${JSON.stringify(report.remaining)}`);
    for (const rule of FIXABLE_IN_MULTI) {
      const entry = report.fixed.find(f => f.antipattern === rule);
      assert.ok(entry && entry.fixed >= 1, `expected ${rule} to be fixed`);
      assert.equal(entry.after, 0, `expected 0 remaining ${rule}`);
    }
    const skippedBroken = report.skipped.find(s => s.antipattern === 'broken-image');
    assert.ok(skippedBroken, 'broken-image should be reported as skipped');
    assert.match(skippedBroken.reason, /content decision/);

    // Independent re-detect: fixable rules gone, unfixable still present.
    const after = await detectHtml(file, {});
    for (const rule of FIXABLE_IN_MULTI) {
      assert.equal(after.filter(f => f.antipattern === rule).length, 0,
        `expected ${rule} gone after fix`);
    }
    assert.ok(after.some(f => f.antipattern === 'broken-image'));
  });

  it('second run is a no-op (convergence, no oscillation)', async () => {
    const tmp = makeTmpDir();
    const file = path.join(tmp, 'page.html');
    fs.copyFileSync(path.join(FIXTURES, 'multi-issue.broken.html'), file);
    await runFix([file], { cwd: tmp });
    const contentAfterFirst = fs.readFileSync(file, 'utf-8');

    const second = await runFix([file], { cwd: tmp });
    assert.equal(second.filesChanged.length, 0, 'second pass must not edit anything');
    assert.equal(fs.readFileSync(file, 'utf-8'), contentAfterFirst);
    assert.equal(second.fixed.length, 0);
  });

  it('--dry-run: prints diffs, touches nothing on disk', async () => {
    const tmp = makeTmpDir();
    const file = path.join(tmp, 'page.html');
    fs.copyFileSync(path.join(FIXTURES, 'multi-issue.broken.html'), file);
    const original = fs.readFileSync(file, 'utf-8');

    const report = await runFix([file], { cwd: tmp, dryRun: true });
    assert.equal(report.dryRun, true);
    assert.equal(fs.readFileSync(file, 'utf-8'), original, 'dry-run must not modify the file');
    assert.ok(report.diffs.length > 0);
    const diff = report.diffs[0].diff;
    assert.match(diff, /^--- a\//m);
    assert.match(diff, /^\+\+\+ b\//m);
    assert.match(diff, /^-.*line-height: 1\.1/m);
    assert.match(diff, /^\+.*line-height: 1\.5/m);
  });

  it('never touches files with no findings', async () => {
    const tmp = makeTmpDir();
    const clean = path.join(tmp, 'clean.css');
    fs.writeFileSync(clean, '.ok {\n  transition: opacity 0.2s ease;\n}\n');
    const report = await runFix([clean], { cwd: tmp });
    assert.equal(report.filesChanged.length, 0);
    assert.equal(report.fixed.length, 0);
  });

  it('honors inline monodesign-disable directives (never fixes an ignored finding)', async () => {
    const tmp = makeTmpDir();
    const file = path.join(tmp, 'panel.css');
    fs.writeFileSync(file,
      '/* monodesign-disable layout-transition -- intentional resize animation */\n' +
      '.panel {\n  transition: width 0.3s ease;\n}\n');
    const original = fs.readFileSync(file, 'utf-8');
    const report = await runFix([file], { cwd: tmp });
    assert.equal(report.filesChanged.length, 0);
    assert.equal(fs.readFileSync(file, 'utf-8'), original);
  });

  it('honors .monodesign config ignoreRules', async () => {
    const tmp = makeTmpDir();
    fs.mkdirSync(path.join(tmp, '.monodesign'));
    fs.writeFileSync(path.join(tmp, '.monodesign', 'config.json'),
      JSON.stringify({ detector: { ignoreRules: ['layout-transition'] } }));
    const file = path.join(tmp, 'panel.css');
    fs.writeFileSync(file, '.panel {\n  transition: width 0.3s ease;\n}\n');
    const original = fs.readFileSync(file, 'utf-8');
    const report = await runFix([file], { cwd: tmp });
    assert.equal(report.filesChanged.length, 0);
    assert.equal(fs.readFileSync(file, 'utf-8'), original);
  });

  it('--rule restricts fixing; excluded rules are reported as skipped', async () => {
    const tmp = makeTmpDir();
    const file = path.join(tmp, 'page.html');
    fs.copyFileSync(path.join(FIXTURES, 'multi-issue.broken.html'), file);

    const report = await runFix([file], { cwd: tmp, rules: ['tiny-text'] });
    assert.equal(report.fixed.length, 1);
    assert.equal(report.fixed[0].antipattern, 'tiny-text');
    assert.ok(report.skipped.some(s => s.antipattern === 'tight-leading' && s.reason === 'excluded by --rule'));

    const after = await detectHtml(file, {});
    assert.equal(after.filter(f => f.antipattern === 'tiny-text').length, 0);
    assert.ok(after.some(f => f.antipattern === 'tight-leading'), 'excluded rule must remain');
  });

  it('fixes declarations living in a linked stylesheet', async () => {
    const tmp = makeTmpDir();
    const cssFile = path.join(tmp, 'styles.css');
    const htmlFile = path.join(tmp, 'page.html');
    fs.writeFileSync(cssFile, '.prose {\n  font-size: 16px;\n  line-height: 1.1;\n}\n');
    fs.writeFileSync(htmlFile,
      '<!doctype html>\n<html>\n<head>\n<title>Linked</title>\n' +
      '<link rel="stylesheet" href="styles.css">\n</head>\n<body>\n' +
      '<p class="prose">This paragraph carries well over fifty characters of readable body copy for the check.</p>\n' +
      '</body>\n</html>\n');

    const report = await runFix([htmlFile], { cwd: tmp });
    const entry = report.fixed.find(f => f.antipattern === 'tight-leading');
    assert.ok(entry, 'expected tight-leading fix through linked css');
    assert.equal(entry.targetFile, cssFile);
    assert.match(fs.readFileSync(cssFile, 'utf-8'), /line-height: 1\.5/);
    assert.equal(report.remaining.length, 0);
  });

  it('fixes layout-transition in plain css end-to-end (regex engine findings)', async () => {
    const tmp = makeTmpDir();
    const file = path.join(tmp, 'panel.css');
    fs.copyFileSync(path.join(FIXTURES, 'layout-transition.broken.css'), file);
    const report = await runFix([file], { cwd: tmp });
    assert.deepEqual(report.filesChanged, [file]);
    assert.equal(report.remaining.length, 0);
    assert.equal(fs.readFileSync(file, 'utf-8'), readFixture('layout-transition.fixed.css'));
    assert.equal(detectText(fs.readFileSync(file, 'utf-8'), file, {})
      .filter(f => f.antipattern === 'layout-transition').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Supporting units
// ---------------------------------------------------------------------------

describe('fix engine units', () => {
  it('applyEdits drops overlapping edits (first wins) and applies in order', () => {
    const { content, applied } = applyEdits('abcdef', [
      { start: 4, end: 5, replacement: 'E' },
      { start: 0, end: 2, replacement: 'X' },
      { start: 1, end: 3, replacement: 'Y' }, // overlaps the first — dropped
    ]);
    assert.equal(content, 'XcdEf');
    assert.equal(applied.length, 2);
  });

  it('unifiedDiff emits a valid single hunk with context', () => {
    const diff = unifiedDiff('a\nb\nc\nd\ne\n', 'a\nb\nC\nd\ne\n', 'x.css');
    assert.match(diff, /^--- a\/x\.css\n\+\+\+ b\/x\.css\n@@ /);
    assert.match(diff, /\n-c\n\+C\n/);
  });

  it('every registered fixer has a description', () => {
    for (const [id, fixer] of Object.entries(FIXERS)) {
      assert.ok(fixer.description, `${id} missing description`);
      assert.equal(typeof fixer.fix, 'function');
    }
  });
});
