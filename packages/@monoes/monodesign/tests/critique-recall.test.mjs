/**
 * Tests for the critique `recall` surface: trend direction, open-P0/P1
 * extraction from snapshot bodies, and the recall subcommand that combines
 * latest + trend into one compact markdown block for polish/critique.
 *
 * Fixture snapshots live in tests/fixtures/critique-snapshots/ and are
 * copied into a scratch project's .monodesign/critique per test.
 *
 * Run with: node --test tests/critique-recall.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  extractIssueLines,
  trendDirection,
  readRecall,
  formatRecall,
} from '../skill/scripts/critique-storage.mjs';

const SCRIPT = fileURLToPath(new URL('../skill/scripts/critique-storage.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/critique-snapshots', import.meta.url));

let cwd;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monodesign-recall-')); });
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

function installFixtures() {
  const dir = path.join(cwd, '.monodesign', 'critique');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(FIXTURES)) {
    if (!f.endsWith('.md') || f.startsWith('.')) continue;
    fs.copyFileSync(path.join(FIXTURES, f), path.join(dir, f));
  }
  return dir;
}

describe('extractIssueLines', () => {
  it('extracts P0 and P1 titles from report-style lines, ignoring P2', () => {
    const body = fs.readFileSync(path.join(FIXTURES, '2026-05-10T10-00-00Z__home.md'), 'utf-8');
    const issues = extractIssueLines(body);
    assert.deepEqual(issues.p0, ['Form submits with no feedback']);
    assert.deepEqual(issues.p1, ['Nav labels use internal jargon', 'Focus indicators removed']);
  });

  it('does not read frontmatter keys as issues', () => {
    const body = '---\np0_count: 3\nslug: x\n---\nno tagged lines here\n';
    assert.deepEqual(extractIssueLines(body), { p0: [], p1: [] });
  });

  it('tolerates loose formatting and strips markdown emphasis', () => {
    const body = [
      '* [P0] Plain bullet without bold',
      '**[P1] Bold title**: with explanation',
      '[p1] lowercase tag works too',
    ].join('\n');
    const issues = extractIssueLines(body);
    assert.deepEqual(issues.p0, ['Plain bullet without bold']);
    assert.deepEqual(issues.p1, ['Bold title', 'lowercase tag works too']);
  });

  it('dedupes and caps at max', () => {
    const body = Array.from({ length: 12 }, (_, i) => `- **[P0] Issue ${i}**: x`)
      .concat(['- **[P0] Issue 0**: repeated'])
      .join('\n');
    const issues = extractIssueLines(body, { max: 8 });
    assert.equal(issues.p0.length, 8);
  });

  it('returns empty buckets for empty / non-string bodies', () => {
    assert.deepEqual(extractIssueLines(''), { p0: [], p1: [] });
    assert.deepEqual(extractIssueLines(null), { p0: [], p1: [] });
  });
});

describe('trendDirection', () => {
  it('reports improving / declining / flat over the last 3 scores', () => {
    assert.equal(trendDirection([22, 26, 30]), 'improving');
    assert.equal(trendDirection([30, 26, 22]), 'declining');
    assert.equal(trendDirection([26, 30, 26]), 'flat');
  });

  it('only considers the last 3 entries', () => {
    // Full series is improving, but last 3 decline.
    assert.equal(trendDirection([10, 40, 38, 35]), 'declining');
  });

  it('ignores non-finite scores and needs at least 2 points', () => {
    assert.equal(trendDirection([null, 22, undefined, 30]), 'improving');
    assert.equal(trendDirection([30]), null);
    assert.equal(trendDirection([]), null);
    assert.equal(trendDirection(null), null);
  });
});

describe('readRecall + formatRecall', () => {
  it('combines latest snapshot, trend, and open issues for a slug', () => {
    installFixtures();
    const recall = readRecall('home', { cwd });
    assert.equal(recall.slug, 'home');
    assert.equal(recall.latest.meta.total_score, 30);
    assert.deepEqual(recall.scores, [22, 26, 30]);
    assert.equal(recall.direction, 'improving');
    assert.deepEqual(recall.issues.p0, ['Form submits with no feedback']);
  });

  it('is slug-scoped: pricing snapshots do not leak into home', () => {
    installFixtures();
    const recall = readRecall('pricing', { cwd });
    assert.deepEqual(recall.scores, [18]);
    assert.equal(recall.direction, null);
    assert.deepEqual(recall.issues.p0, ['Five pricing tiers cause analysis paralysis']);
  });

  it('returns null when no snapshot exists', () => {
    assert.equal(readRecall('never-written', { cwd }), null);
  });

  it('formats a compact markdown block', () => {
    installFixtures();
    const md = formatRecall(readRecall('home', { cwd }), { cwd });
    assert.match(md, /## Design health: `home`/);
    assert.match(md, /Latest score: 30\/40 \(P0: 1, P1: 2\)/);
    assert.match(md, /Trend \(last 3\): 22 → 26 → 30 \(improving\)/);
    assert.match(md, /- Open P0:\n {2}- Form submits with no feedback/);
    assert.match(md, /- Open P1:\n {2}- Nav labels use internal jargon/);
    assert.match(md, /Snapshot: \.monodesign\/critique\/2026-05-10T10-00-00Z__home\.md/);
  });
});

describe('recall CLI subcommand', () => {
  it('prints the markdown block and exits 0', () => {
    installFixtures();
    const r = spawnSync(process.execPath, [SCRIPT, 'recall', 'home'], { cwd, encoding: 'utf-8' });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /## Design health: `home`/);
    assert.match(r.stdout, /22 → 26 → 30 \(improving\)/);
    assert.match(r.stdout, /Form submits with no feedback/);
  });

  it('exits 2 when no snapshot exists for the slug', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'recall', 'never-written'], { cwd, encoding: 'utf-8' });
    assert.equal(r.status, 2);
  });

  it('respects an explicit trend limit argument', () => {
    installFixtures();
    const r = spawnSync(process.execPath, [SCRIPT, 'recall', 'home', '2'], { cwd, encoding: 'utf-8' });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /Trend \(last 2\): 26 → 30/);
  });
});
