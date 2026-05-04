import * as path from 'node:path';

export interface WorkspaceFilterOptions {
  root: string;
  patterns: string[];
}

export function filterToWorkspaces<T extends { filePath: string }>(
  results: T[],
  wsRoots: string[],
): T[] {
  if (wsRoots.length === 0) return results;
  return results.filter(r =>
    wsRoots.some(root => r.filePath === root || r.filePath.startsWith(root + path.sep))
  );
}

export function resolveWorkspaceFilters(
  root: string,
  patterns: string[],
  allWorkspaceRoots: string[],
): string[] {
  const positive: string[] = [];
  const negative: string[] = [];
  for (const p of patterns) {
    if (p.startsWith('!')) negative.push(p.slice(1));
    else positive.push(p);
  }

  let matches = positive.length > 0
    ? allWorkspaceRoots.filter(ws => positive.some(p => matchWorkspacePattern(ws, p, root)))
    : allWorkspaceRoots;

  if (negative.length > 0) {
    matches = matches.filter(ws => !negative.some(p => matchWorkspacePattern(ws, p, root)));
  }

  return matches;
}

export function resolveWorkspaceScope(
  root: string,
  workspacePatterns: string[] | undefined,
  changedWorkspaces: string | undefined,
  allWorkspaceRoots: string[],
): string[] {
  if (!workspacePatterns && !changedWorkspaces) return [];

  let scope = workspacePatterns
    ? resolveWorkspaceFilters(root, workspacePatterns, allWorkspaceRoots)
    : allWorkspaceRoots;

  if (changedWorkspaces) {
    const changedSet = new Set(
      changedWorkspaces.split(',').map(s => path.resolve(root, s.trim()))
    );
    scope = scope.filter(ws => changedSet.has(ws));
  }

  return scope;
}

export function getChangedFiles(
  root: string,
  since?: string,
  workspaces?: string[],
): string[] {
  return [];
}

function matchWorkspacePattern(wsRoot: string, pattern: string, root: string): boolean {
  const rel = path.relative(root, wsRoot).replace(/\\/g, '/');
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$');
    return re.test(rel);
  }
  return rel === pattern || wsRoot === pattern || wsRoot.endsWith(path.sep + pattern);
}
