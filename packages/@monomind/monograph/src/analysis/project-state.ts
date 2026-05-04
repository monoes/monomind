import * as path from 'node:path';

export interface ProjectFile {
  fileId: number;
  path: string;
  canonicalPath?: string;
  sizeBytes?: number;
}

export interface WorkspaceEntry {
  root: string;
  name?: string;
  packageJson?: Record<string, unknown>;
}

export interface ProjectState {
  files: ProjectFile[];
  pathToId: Map<string, number>;
  workspaces: WorkspaceEntry[];
}

export function makeProjectState(files: ProjectFile[], workspaces: WorkspaceEntry[]): ProjectState {
  const pathToId = new Map(files.map(f => [f.path, f.fileId]));
  return { files, pathToId, workspaces };
}

export function fileById(state: ProjectState, fileId: number): ProjectFile | undefined {
  return state.files.find(f => f.fileId === fileId);
}

export function idForPath(state: ProjectState, filePath: string): number | undefined {
  return state.pathToId.get(filePath);
}

export function workspaceForFile(state: ProjectState, fileId: number): WorkspaceEntry | undefined {
  const file = fileById(state, fileId);
  if (!file) return undefined;
  const normalized = file.path.replace(/\\/g, '/');
  let bestMatch: WorkspaceEntry | undefined;
  let bestLen = 0;
  for (const ws of state.workspaces) {
    const wsPath = ws.root.replace(/\\/g, '/');
    if (normalized.startsWith(wsPath + '/') || normalized === wsPath) {
      if (wsPath.length > bestLen) {
        bestLen = wsPath.length;
        bestMatch = ws;
      }
    }
  }
  return bestMatch;
}

export function filesInWorkspace(state: ProjectState, workspace: WorkspaceEntry): ProjectFile[] {
  const wsPath = workspace.root.replace(/\\/g, '/');
  return state.files.filter(f => {
    const fp = f.path.replace(/\\/g, '/');
    return fp.startsWith(wsPath + '/') || fp === wsPath;
  });
}

export class PackageResolver {
  private entries: Array<{ root: string; name: string }>;

  constructor(workspaces: WorkspaceEntry[]) {
    this.entries = workspaces
      .filter(w => w.name)
      .map(w => ({ root: w.root, name: w.name! }))
      .sort((a, b) => b.root.length - a.root.length);
  }

  resolvePackage(filePath: string): string | undefined {
    const normalized = filePath.replace(/\\/g, '/');
    for (const entry of this.entries) {
      const rootNorm = entry.root.replace(/\\/g, '/');
      if (normalized.startsWith(rootNorm + '/') || normalized === rootNorm) {
        return entry.name;
      }
    }
    return undefined;
  }

  resolveRoot(packageName: string): string | undefined {
    return this.entries.find(e => e.name === packageName)?.root;
  }
}
