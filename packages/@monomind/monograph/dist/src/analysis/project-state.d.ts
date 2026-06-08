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
export declare function makeProjectState(files: ProjectFile[], workspaces: WorkspaceEntry[]): ProjectState;
export declare function fileById(state: ProjectState, fileId: number): ProjectFile | undefined;
export declare function idForPath(state: ProjectState, filePath: string): number | undefined;
export declare function workspaceForFile(state: ProjectState, fileId: number): WorkspaceEntry | undefined;
export declare function filesInWorkspace(state: ProjectState, workspace: WorkspaceEntry): ProjectFile[];
export declare class PackageResolver {
    private entries;
    constructor(workspaces: WorkspaceEntry[]);
    resolvePackage(filePath: string): string | undefined;
    resolveRoot(packageName: string): string | undefined;
}
//# sourceMappingURL=project-state.d.ts.map