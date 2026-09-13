import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

/**
 * Every hook `command` in settings.json builds a path as
 * `$CLAUDE_PROJECT_DIR/.claude/helpers/...`. Claude Code normally sets this
 * env var for every hook invocation, but when it comes up empty (observed
 * after an EnterWorktree/ExitWorktree cycle in a live session), a bare
 * `$CLAUDE_PROJECT_DIR/` expands to an empty string and the path collapses to
 * `/.claude/helpers/...` — Node then fails with MODULE_NOT_FOUND before the
 * hook script even starts, on every single tool call. settings-generator.ts's
 * `hookCmd()` already guards against this with `${CLAUDE_PROJECT_DIR:-.}`;
 * this test guards the two checked-in settings.json copies that don't come
 * from that generator (repo-root dogfood config + the CLI package's own
 * dogfood copy), so they can't silently drift back to the unguarded form.
 */
function assertNoUnguardedProjectDir(settingsPath: string): void {
  const src = readFileSync(settingsPath, 'utf-8');
  expect(src).not.toContain('$CLAUDE_PROJECT_DIR/');
  expect(src).not.toContain('${CLAUDE_PROJECT_DIR}/');
  // Sanity check the assertions above aren't vacuous (hooks were removed entirely).
  expect(src).toContain('${CLAUDE_PROJECT_DIR:-.}/');
}

describe('settings.json hook commands survive an empty CLAUDE_PROJECT_DIR', () => {
  it('repo-root .claude/settings.json has no unguarded $CLAUDE_PROJECT_DIR', () => {
    assertNoUnguardedProjectDir(join(REPO_ROOT, '.claude', 'settings.json'));
  });

  it('packaged CLI .claude/settings.json has no unguarded $CLAUDE_PROJECT_DIR', () => {
    assertNoUnguardedProjectDir(
      join(REPO_ROOT, 'packages', '@monomind', 'cli', '.claude', 'settings.json'),
    );
  });
});
