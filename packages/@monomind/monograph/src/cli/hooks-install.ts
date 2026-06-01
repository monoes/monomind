import {
  existsSync,
  writeFileSync,
  chmodSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

export const HOOK_MARKER_START = '# monograph-hook-start';
export const HOOK_MARKER_END = '# monograph-hook-end';

/**
 * Rebase / merge / cherry-pick skip guard.
 * Prevents the hook from running during interactive operations.
 */
const SKIP_GUARD = `# Skip during rebase, merge, or cherry-pick
if [ -d "$(git rev-parse --git-dir 2>/dev/null)/rebase-merge" ] || \\
   [ -d "$(git rev-parse --git-dir 2>/dev/null)/rebase-apply" ] || \\
   [ -f "$(git rev-parse --git-dir 2>/dev/null)/MERGE_HEAD" ] || \\
   [ -f "$(git rev-parse --git-dir 2>/dev/null)/CHERRY_PICK_HEAD" ]; then
  exit 0
fi`;

function buildHookBlock(hookName: string): string {
  const verb =
    hookName === 'post-merge' || hookName === 'post-checkout'
      ? 'rebuild knowledge graph after ' + hookName.replace('post-', '')
      : 'rebuild knowledge graph on ' + hookName.replace('pre-', '');

  return [
    HOOK_MARKER_START,
    `# Monograph: ${verb}`,
    SKIP_GUARD,
    'if command -v monograph >/dev/null 2>&1; then',
    '  monograph build --silent || true',
    'elif command -v npx >/dev/null 2>&1; then',
    '  npx monograph build --silent || true',
    'fi',
    HOOK_MARKER_END,
  ].join('\n');
}

/**
 * Detect the git hooks directory, supporting Husky / custom `core.hooksPath`.
 */
function getHooksDir(repoPath: string): string {
  try {
    const custom = execSync('git config core.hooksPath', {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (custom) {
      return join(repoPath, custom);
    }
  } catch {
    // Not configured — fall through to default
  }
  return join(repoPath, '.git', 'hooks');
}

/**
 * Install (or update) monograph hooks by appending a marked block.
 * Existing hook content is preserved. Re-running is idempotent.
 */
export function installGitHooks(repoPath: string, hooks: string[]): void {
  const hooksDir = getHooksDir(repoPath);
  if (!existsSync(hooksDir)) {
    throw new Error(`No .git/hooks directory found at ${repoPath}`);
  }
  for (const hook of hooks) {
    if (!/^[\w-]+$/.test(hook)) {
      throw new Error(`Invalid hook name: "${hook}" — must be alphanumeric with hyphens only`);
    }
    const hookPath = join(hooksDir, hook);
    const block = buildHookBlock(hook);

    let existing = '';
    if (existsSync(hookPath)) {
      existing = readFileSync(hookPath, 'utf8');
    }

    // Remove any existing monograph block (for idempotence)
    const stripped = removeMarkerBlock(existing);

    // If there was no prior content, start with a shebang
    const preamble = stripped.trim()
      ? stripped.trimEnd() + '\n\n'
      : '#!/bin/sh\n\n';

    writeFileSync(hookPath, preamble + block + '\n', 'utf8');
    chmodSync(hookPath, 0o755);
  }
}

/**
 * Remove the monograph marker block from hook content.
 * Returns the content with the block stripped.
 */
function removeMarkerBlock(content: string): string {
  const startIdx = content.indexOf(HOOK_MARKER_START);
  const endIdx = content.indexOf(HOOK_MARKER_END);
  if (startIdx === -1) return content;
  const afterEnd = endIdx !== -1 ? content.slice(endIdx + HOOK_MARKER_END.length) : '';
  return content.slice(0, startIdx) + afterEnd;
}

/**
 * Uninstall monograph from hooks.
 * Only removes the marker block — surrounding content is preserved.
 * Removes the file entirely if nothing meaningful remains.
 */
export function uninstallGitHooks(repoPath: string, hooks: string[]): void {
  const hooksDir = getHooksDir(repoPath);
  for (const hook of hooks) {
    if (!/^[\w-]+$/.test(hook)) {
      throw new Error(`Invalid hook name: "${hook}" — must be alphanumeric with hyphens only`);
    }
    const hookPath = join(hooksDir, hook);
    if (!existsSync(hookPath)) continue;
    const original = readFileSync(hookPath, 'utf8');
    if (!original.includes(HOOK_MARKER_START)) continue;
    const stripped = removeMarkerBlock(original);
    // If only a shebang (or whitespace) remains, the file was created entirely by us
    const meaningful = stripped.replace(/^#!.*$/m, '').trim();
    if (!meaningful) {
      // Remove the file — nothing custom was there
      try {
        unlinkSync(hookPath);
      } catch {
        writeFileSync(hookPath, stripped, 'utf8');
      }
    } else {
      writeFileSync(hookPath, stripped.trimEnd() + '\n', 'utf8');
    }
  }
}

/**
 * List hook names that contain a monograph marker block.
 */
export function listInstalledHooks(repoPath: string): string[] {
  const hooksDir = getHooksDir(repoPath);
  if (!existsSync(hooksDir)) return [];
  const installed: string[] = [];
  for (const f of readdirSync(hooksDir)) {
    try {
      const content = readFileSync(join(hooksDir, f), 'utf8');
      if (content.includes(HOOK_MARKER_START)) installed.push(f);
    } catch { /* skip */ }
  }
  return installed;
}

export interface PerHookStatus {
  installed: boolean;
  path: string;
  hasCustomContent: boolean;
}

export interface HookStatus {
  installed: boolean;
  hooks: string[];
  hooksDir: string;
  /** Per-hook details keyed by hook name. */
  perHook?: Record<string, PerHookStatus>;
}

export function getHookStatus(repoPath: string): HookStatus {
  const hooksDir = getHooksDir(repoPath);
  let installed: string[] = [];
  try {
    installed = listInstalledHooks(repoPath);
  } catch { /* .git dir missing or unreadable */ }

  // Build per-hook status for all known hooks + any installed ones
  const knownHooks = ['pre-commit', 'post-merge', 'post-checkout', 'pre-push'];
  const allHooks = new Set([...knownHooks, ...installed]);
  const perHook: Record<string, PerHookStatus> = {};
  for (const hook of allHooks) {
    const hookPath = join(hooksDir, hook);
    const isInstalled = installed.includes(hook);
    let hasCustomContent = false;
    if (existsSync(hookPath)) {
      const content = readFileSync(hookPath, 'utf8');
      const stripped = removeMarkerBlock(content);
      hasCustomContent = stripped.replace(/^#!.*$/m, '').trim().length > 0;
    }
    perHook[hook] = { installed: isInstalled, path: hookPath, hasCustomContent };
  }

  return {
    installed: installed.length > 0,
    hooks: installed,
    hooksDir,
    perHook,
  };
}
