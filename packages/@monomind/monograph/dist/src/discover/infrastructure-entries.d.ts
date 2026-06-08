export type InfraFileKind = 'dockerfile' | 'docker-compose' | 'procfile' | 'fly-toml' | 'render-yaml' | 'railway-toml' | 'heroku-procfile';
export interface InfraEntryPoint {
    filePath: string;
    kind: InfraFileKind;
    discoveredEntries: string[];
}
export declare function detectInfraFiles(projectRoot: string): InfraEntryPoint[];
export declare function parseDockerfileEntries(content: string): string[];
export declare function parseProcfileEntries(content: string): string[];
//# sourceMappingURL=infrastructure-entries.d.ts.map