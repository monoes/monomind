/**
 * GH #344: init no longer writes `skills:<platform>:<name>` ownership markers
 * into skill files (ownership lives in `.monomind/init-manifest.json`), so no
 * committed skill file in any tree may carry one. A marker here would be
 * copied to npm users by the shipped tree or re-propagated by the mirrors.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('committed skill trees', () => {
  it('carry no `monomind:start skills:` ownership markers', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((rel) => /(^|\/)skills\//.test(rel) && /\.(md|txt)$/.test(rel));
    expect(files.length).toBeGreaterThan(100);

    const marked = files.filter((rel) => {
      try {
        return /monomind:(?:start|end)\s+skills:/.test(readFileSync(join(REPO_ROOT, rel), 'utf8'));
      } catch {
        return false; // listed but deleted in the working tree
      }
    });
    expect(marked).toEqual([]);
  });
});
