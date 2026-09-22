/**
 * The commit-msg advisory that suggests a closing keyword when a commit only
 * references an issue (`(#310)`), which left fixed issues open.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { suggestClosingKeywords } from '../../scripts/commit-msg-issue-refs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../scripts/commit-msg-issue-refs.mjs');

const hint = (n) =>
  `[commit-msg] #${n} is referenced but not closed — add "Fixes #${n}" to the body if this commit resolves it`;

describe('suggestClosingKeywords', () => {
  const cases = [
    ['bare reference in the subject', 'fix(cli): stop crash (#310)', [310]],
    ['reference in the body', 'fix(cli): stop crash\n\nSee #296 for context.', [296]],
    ['no reference at all', 'chore: tidy', []],
    ['closed in the body', 'fix(cli): stop crash (#310)\n\nFixes #310', []],
    ['keyword with colon', 'fix: x (#310)\n\nCloses: #310', []],
    ['keyword is case-insensitive', 'fix: x\n\nRESOLVED #8', []],
    ...[
      'close',
      'closes',
      'closed',
      'fix',
      'fixes',
      'fixed',
      'resolve',
      'resolves',
      'resolved',
    ].map((kw) => [`keyword "${kw}"`, `fix: x (#5)\n\n${kw} #5`, []]),
    ['keyword covers only its own issue', 'fix: x\n\nFixes #1, #2', [2]],
    ['each issue reported once, in order', 'fix: a #9 and #3\n\n#9 again, #3 again', [9, 3]],
    ['one of two closed', 'fix: x (#308)\n\nFixes #310\nRelated to #308', [308]],
    [
      'closing issue URL counts as closed',
      'fix: x (#42)\n\nFixes https://github.com/monoes/monomind/issues/42',
      [],
    ],
    ['#N inside a URL is not a reference', 'docs: see https://example.com/page#12', []],
    ['cross-repo reference ignored', 'chore: bump, see other/repo#77', []],
    ['HTML entity ignored', 'fix: escape &#39; in output', []],
    ['word#N ignored', 'fix: handle a#1 selectors', []],
    ['git comment lines ignored', 'fix: x\n\n# Please enter the commit message for #12\n#', []],
    [
      'diff below scissors ignored',
      'fix: x\n# ------------------------ >8 ------------------------\n+ see #4',
      [],
    ],
    ['keyword word inside another word does not close', 'fix: x (#6)\n\nprefixes #6', [6]],
    ['merge commit skipped', "Merge branch 'main' (#310)", []],
    ['revert skipped', 'Revert "fix: x (#310)"', []],
    ['fixup! skipped', 'fixup! fix: x (#310)', []],
    ['squash! skipped', 'squash! fix: x (#310)', []],
  ];

  it.each(cases)('%s', (_name, message, expected) => {
    expect(suggestClosingKeywords(message)).toEqual(expected.map(hint));
  });
});

describe('CLI', () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const run = (message) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'commit-msg-refs-'));
    dirs.push(dir);
    const file = path.join(dir, 'COMMIT_EDITMSG');
    writeFileSync(file, message);
    return spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
  };

  it('prints suggestions and still exits 0', () => {
    const r = run('fix(cli): stop crash (#310)\n');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(hint(310));
  });

  it('is silent for a closed issue', () => {
    const r = run('fix(cli): stop crash\n\nFixes #310\n');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('exits 0 when the message file is missing', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '/nonexistent/COMMIT_EDITMSG'], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
