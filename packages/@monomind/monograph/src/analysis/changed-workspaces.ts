import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join, relative, resolve } from 'path';

export interface WorkspacePackage {
  name: string;
  root: string;
  hasChanges: boolean;
}

function findWorkspaceRoots(projectRoot: string): string[] {
  // Detect pnpm/npm/yarn workspaces
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(
      require('fs').readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    );
  } catch { return []; }

  const workspaceGlobs: string[] =
    (pkg['workspaces'] as string[] | { packages: string[] } | undefined) instanceof Array
      ? pkg['workspaces'] as string[]
      : (pkg['workspaces'] as { packages?: string[] } | undefined)?.packages ?? [];

  if (workspaceGlobs.length === 0) return [];

  const roots: string[] = [];
  for (const glob of workspaceGlobs) {
    // Simple glob: support "packages/*" and "apps/*"
    if (glob.endsWith('/*')) {
      const dir = join(projectRoot, glob.slice(0, -2));
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) roots.push(join(dir, e.name));
        }
      } catch { /* ignore */ }
    } else {
      const absPath = join(projectRoot, glob);
      if (existsSync(absPath)) roots.push(absPath);
    }
  }
  return roots;
}

export function getChangedWorkspaces(
  projectRoot: string,
  sinceRef: string,
  workspaceRoots?: string[],
): WorkspacePackage[] {
  // Validate git ref (same allowlist as changed-files.ts)
  if (!/^[a-zA-Z0-9\-_./@~^]+$/.test(sinceRef)) {
    throw new Error(`Invalid git ref: "${sinceRef}"`);
  }

  let changedFiles: Set<string>;
  try {
    const raw = execSync(
      `git -C "${projectRoot}" diff --name-only "${sinceRef}"...HEAD`,
      { encoding: 'utf8' }
    );
    changedFiles = new Set(raw.split('\n').map(l => l.trim()).filter(Boolean));
  } catch {
    changedFiles = new Set();
  }

  const roots = workspaceRoots ?? findWorkspaceRoots(projectRoot);

  return roots.map(root => {
    const relRoot = relative(projectRoot, root).replace(/\\/g, '/') + '/';
    const hasChanges = [...changedFiles].some(f => f.startsWith(relRoot));
    const pkgName = root.split(/[\\/]/).pop() ?? root;
    return { name: pkgName, root: resolve(root), hasChanges };
  });
}

export function resolveChangedWorkspaceRoots(
  projectRoot: string,
  sinceRef: string,
  workspaceRoots?: string[],
): string[] {
  return getChangedWorkspaces(projectRoot, sinceRef, workspaceRoots)
    .filter(w => w.hasChanges)
    .map(w => w.root);
}
