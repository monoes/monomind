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
  /** O(1) lookup by numeric fileId */
  idToFile: Map<number, ProjectFile>;
  workspaces: WorkspaceEntry[];
}

export function makeProjectState(files: ProjectFile[], workspaces: WorkspaceEntry[]): ProjectState {
  // Build both lookup maps in a single pass to avoid intermediate arrays
  const pathToId = new Map<string, number>();
  const idToFile = new Map<number, ProjectFile>();
  for (const f of files) {
    pathToId.set(f.path, f.fileId);
    idToFile.set(f.fileId, f);
  }
  return { files, pathToId, idToFile, workspaces };
}

export function fileById(state: ProjectState, fileId: number): ProjectFile | undefined {
  // O(1) lookup via idToFile map instead of O(N) linear scan
  return state.idToFile.get(fileId);
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
    // Combine filter + map into a single for-of loop to avoid 2 intermediate arrays
    const named: Array<{ root: string; name: string }> = [];
    for (const w of workspaces) {
      if (w.name) named.push({ root: w.root, name: w.name });
    }
    named.sort((a, b) => b.root.length - a.root.length);
    this.entries = named;
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
