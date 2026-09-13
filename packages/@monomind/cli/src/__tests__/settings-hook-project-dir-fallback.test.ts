import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

const ROOT_SETTINGS = join(REPO_ROOT, '.claude', 'settings.json');
const CLI_SETTINGS = join(REPO_ROOT, 'packages', '@monomind', 'cli', '.claude', 'settings.json');

/**
 * Every hook `command` in settings.json locates the project by resolving
 * `$p`: prefer `$CLAUDE_PROJECT_DIR` if it actually contains `.claude/helpers`,
 * else `$PWD` (same check), else walk up parent directories until
 * `.claude/helpers` is found or the filesystem root is hit. This matters
 * because `$CLAUDE_PROJECT_DIR` can come up empty or stale (observed in a
 * live session after an EnterWorktree/ExitWorktree cycle) — a naive
 * `${CLAUDE_PROJECT_DIR:-.}` fallback only works if cwd happens to already
 * be the project root, and blindly trusting a stale env var is worse. Every
 * hook command in the file must build $p through this validated search, not
 * through a bare or blindly-defaulted variable substitution.
 *
 * settings-generator.ts's `hookCmd()`/`standaloneHelperCmd()`/
 * `captureHandlerCmd()` already build commands this way; the two checked-in
 * settings.json copies here (repo-root dogfood config + the CLI package's
 * own dogfood copy) aren't sourced from that generator, so this guards them
 * against drifting back to a weaker form.
 */
function assertUsesValidatedSearch(settingsPath: string): void {
  const src = readFileSync(settingsPath, 'utf-8');
  // No hook command may trust either variable without checking it first.
  expect(src).not.toContain('$CLAUDE_PROJECT_DIR/');
  expect(src).not.toContain('${CLAUDE_PROJECT_DIR}/');
  expect(src).not.toContain('${CLAUDE_PROJECT_DIR:-.}/');
  // Every command must validate the candidate against the real marker...
  // (raw file text is JSON-escaped, so `"` is stored as `\"`)
  expect(src).toContain('[ -d \\"$p/.claude/helpers\\" ]');
  // ...and walk up parents when neither candidate is the project root.
  expect(src).toContain('while [ ! -d \\"$p/.claude/helpers\\" ]');
}

/** Pull the `command` string for the PreToolUse Bash (`pre-bash`) hook out of a settings.json. */
function extractPreBashCommand(settingsPath: string): string {
  const data = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  for (const entry of data.hooks.PreToolUse) {
    if (entry.matcher !== 'Bash') continue;
    for (const hook of entry.hooks) {
      if (typeof hook.command === 'string' && hook.command.includes('hook-handler.cjs')) {
        return hook.command;
      }
    }
  }
  throw new Error(`no Bash pre-bash hook command found in ${settingsPath}`);
}

/** Minimal stub standing in for the real hook-handler.cjs: prints a marker and exits 0. */
function installStubHookHandler(projectDir: string): void {
  mkdirSync(join(projectDir, '.claude', 'helpers'), { recursive: true });
  writeFileSync(
    join(projectDir, '.claude', 'helpers', 'hook-handler.cjs'),
    'process.stdout.write("FOUND_IT"); process.exit(0);\n',
  );
}

/** Run a settings.json hook `command` string exactly as Claude Code would: through a shell. */
function runHookCommand(command: string, cwd: string, env: NodeJS.ProcessEnv): string {
  return execFileSync('/bin/sh', ['-c', command], { cwd, env, encoding: 'utf-8', timeout: 10000 });
}

describe('settings.json hook commands build $p through a validated search', () => {
  it('repo-root .claude/settings.json', () => {
    assertUsesValidatedSearch(ROOT_SETTINGS);
  });

  it('packaged CLI .claude/settings.json', () => {
    assertUsesValidatedSearch(CLI_SETTINGS);
  });
});

describe.each([
  ['repo-root', ROOT_SETTINGS],
  ['packaged CLI', CLI_SETTINGS],
])('%s settings.json pre-bash hook command, run for real', (_label, settingsPath) => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-hook-search-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('finds the project root from a nested subdirectory when CLAUDE_PROJECT_DIR is unset', () => {
    const project = join(tmp, 'project');
    installStubHookHandler(project);
    const deepCwd = join(project, 'sub', 'subsub');
    mkdirSync(deepCwd, { recursive: true });

    const command = extractPreBashCommand(settingsPath);
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;

    const stdout = runHookCommand(command, deepCwd, env);
    expect(stdout).toContain('FOUND_IT');
  });

  it('falls back to $PWD when CLAUDE_PROJECT_DIR points at a stale/deleted directory', () => {
    const project = join(tmp, 'project');
    installStubHookHandler(project);

    const command = extractPreBashCommand(settingsPath);
    const env = { ...process.env, CLAUDE_PROJECT_DIR: join(tmp, 'deleted-worktree-that-does-not-exist') };

    const stdout = runHookCommand(command, project, env);
    expect(stdout).toContain('FOUND_IT');
  });

  it('fails without hanging when no project can be found', () => {
    const emptyDir = join(tmp, 'nothing', 'here');
    mkdirSync(emptyDir, { recursive: true });

    const command = extractPreBashCommand(settingsPath);
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;

    expect(() => runHookCommand(command, emptyDir, env)).toThrow();
  });
});
