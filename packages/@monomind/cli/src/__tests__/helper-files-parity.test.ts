import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FORCE_SYNC_HELPERS } from '../init/helpers-generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

// session-restore-handler.cjs is a standalone runtime hook script (plain CJS,
// no build step, must have zero dependency on the TS build) so it can't
// import FORCE_SYNC_HELPERS directly — it keeps its own hardcoded copy of
// the same list, which previously drifted silently from the 3 other
// hardcoded copies this session's refactor consolidated (see
// docs/mastermind/plans/2026-07-17-app-audit-plan.md). This test is the
// substitute for that missing import: it fails CI the moment the two lists
// disagree, instead of the drift going unnoticed for releases like router.cjs
// did before.
function extractHelpersToCheck(cjsPath: string): string[] {
  const src = readFileSync(cjsPath, 'utf-8');
  const match = src.match(/var helpersToCheck = \[([^\]]+)\];/);
  if (!match) throw new Error(`Could not find helpersToCheck array in ${cjsPath}`);
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

describe('session-restore-handler.cjs helper list stays in sync with HELPER_FILES', () => {
  it('root .claude copy matches FORCE_SYNC_HELPERS', () => {
    const helpers = extractHelpersToCheck(
      join(REPO_ROOT, '.claude', 'helpers', 'handlers', 'session-restore-handler.cjs'),
    );
    expect(helpers.slice().sort()).toEqual(FORCE_SYNC_HELPERS.slice().sort());
  });

  it('npm-published package copy matches FORCE_SYNC_HELPERS', () => {
    const helpers = extractHelpersToCheck(
      join(REPO_ROOT, 'packages', '@monomind', 'cli', '.claude', 'helpers', 'handlers', 'session-restore-handler.cjs'),
    );
    expect(helpers.slice().sort()).toEqual(FORCE_SYNC_HELPERS.slice().sort());
  });

  it('the two session-restore-handler.cjs copies match each other', () => {
    const root = extractHelpersToCheck(
      join(REPO_ROOT, '.claude', 'helpers', 'handlers', 'session-restore-handler.cjs'),
    );
    const published = extractHelpersToCheck(
      join(REPO_ROOT, 'packages', '@monomind', 'cli', '.claude', 'helpers', 'handlers', 'session-restore-handler.cjs'),
    );
    expect(published.slice().sort()).toEqual(root.slice().sort());
  });
});
