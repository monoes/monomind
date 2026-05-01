import { existsSync, writeFileSync, chmodSync, unlinkSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const HOOK_TEMPLATES: Record<string, string> = {
  'pre-commit': `#!/bin/sh
# Monograph: rebuild knowledge graph on commit
if command -v monograph >/dev/null 2>&1; then
  monograph build --silent || true
elif command -v npx >/dev/null 2>&1; then
  npx monograph build --silent || true
fi
`,
  'post-merge': `#!/bin/sh
# Monograph: rebuild knowledge graph after merge
if command -v monograph >/dev/null 2>&1; then
  monograph build --silent || true
elif command -v npx >/dev/null 2>&1; then
  npx monograph build --silent || true
fi
`,
};

function getHooksDir(repoPath: string): string {
  return join(repoPath, '.git', 'hooks');
}

export function installGitHooks(repoPath: string, hooks: string[]): void {
  const hooksDir = getHooksDir(repoPath);
  if (!existsSync(hooksDir)) {
    throw new Error(`No .git/hooks directory found at ${repoPath}`);
  }
  for (const hook of hooks) {
    const template = HOOK_TEMPLATES[hook] ?? HOOK_TEMPLATES['pre-commit']!.replace(/pre-commit/g, hook);
    const hookPath = join(hooksDir, hook);
    writeFileSync(hookPath, template, 'utf8');
    chmodSync(hookPath, 0o755);
  }
}

export function uninstallGitHooks(repoPath: string, hooks: string[]): void {
  const hooksDir = getHooksDir(repoPath);
  for (const hook of hooks) {
    const hookPath = join(hooksDir, hook);
    if (existsSync(hookPath)) {
      unlinkSync(hookPath);
    }
  }
}

export function listInstalledHooks(repoPath: string): string[] {
  const hooksDir = getHooksDir(repoPath);
  if (!existsSync(hooksDir)) return [];
  const installed: string[] = [];
  for (const f of readdirSync(hooksDir)) {
    try {
      const content = readFileSync(join(hooksDir, f), 'utf8');
      if (content.includes('monograph')) installed.push(f);
    } catch { /* skip */ }
  }
  return installed;
}

export interface HookStatus {
  installed: boolean;
  hooks: string[];
  hooksDir: string;
}

export function getHookStatus(repoPath: string): HookStatus {
  const hooksDir = join(repoPath, '.git', 'hooks');
  let installed: string[] = [];
  try {
    installed = listInstalledHooks(repoPath);
  } catch { /* .git dir missing or unreadable */ }
  return {
    installed: installed.length > 0,
    hooks: installed,
    hooksDir,
  };
}
