/**
 * Monograph Compatibility Layer
 *
 * Provides the ~27 high-level functions that the CLI calls but that are NOT
 * exported by @monoes/monograph@1.1.0 (which only exports low-level primitives).
 *
 * All implementations are composed from the real published primitives.
 * Where primitives are insufficient, behaviour degrades honestly with correctly-
 * shaped return values so that handler code that accesses specific fields never throws.
 *
 * Import pattern:
 *   - Real primitives: from '@monoes/monograph'
 *   - These compat functions: from './monograph-compat.js'
 */
import { openDb } from '@monoes/monograph';
type Db = ReturnType<typeof openDb>;
export declare function hybridQuery(db: Db, query: string, opts?: {
    limit?: number;
    label?: string;
}): Promise<{
    id: string;
    name: string;
    label: string;
    filePath: string | null;
    score: number;
}[]>;
export declare function semanticSearch(db: Db, query: string, limit?: number, label?: string): {
    id: string;
    name: string;
    label: string;
    normLabel: string;
    filePath: string | null;
    score: number;
}[];
export declare function getMonographContext(db: Db, opts: {
    name: string;
    filePath?: string;
}): {
    target: {
        id: string;
        name: string;
        label: string;
        filePath: string | null;
        communityId?: number;
    };
    callers: {
        id: string;
        name: string;
        label: string;
        filePath: string | null;
    }[];
    callees: {
        id: string;
        name: string;
        label: string;
        filePath: string | null;
    }[];
    imports: {
        id: string;
        name: string;
        label: string;
        filePath: string | null;
    }[];
    importedBy: {
        id: string;
        name: string;
        label: string;
        filePath: string | null;
    }[];
    community: number | null;
    processes: string[];
};
export declare function getMonographImpact(db: Db, opts: {
    name: string;
    filePath?: string;
    depth?: number;
}): {
    target: {
        id: string;
        name: string;
        label: string;
        filePath: string | null;
    };
    impactedSymbols: {
        id: string;
        name: string;
        label: string;
        filePath: string | null;
        depth: number;
    }[];
    totalImpacted: number;
    riskScore: number;
    maxDepthReached: number;
};
export declare function getMonographRename(db: Db, opts: {
    oldName: string;
    newName: string;
    filePath?: string;
    dryRun?: boolean;
}): {
    oldName: string;
    newName: string;
    occurrences: {
        filePath: string | null;
        line: number | null;
        kind: string;
    }[];
    fileCount: number;
    dryRun: true;
};
export declare function detectMonographChanges(db: Db, opts: {
    baseBranch?: string;
    includeTests?: boolean;
}, repoPath: string): {
    baseBranch: string;
    changedFiles: string[];
    affectedSymbols: {
        id: string;
        name: string;
        label: string;
        filePath: string;
    }[];
    symbolCount: number;
};
export declare function getMonographRouteMap(db: Db, opts: {
    prefix?: string;
    method?: string;
    includeMiddleware?: boolean;
}): {
    routes: {
        path: string;
        method: string;
        handler: string | null;
        filePath: string | null;
        line: number | null;
    }[];
    total: number;
};
export declare function getMonographApiImpact(db: Db, opts: {
    routePath: string;
    method?: string;
}): {
    route: string;
    handler: string | null;
    impactedSymbols: {
        id: string;
        name: string;
        label: string;
        filePath: string | null;
        depth: number;
    }[];
    totalImpacted: number;
    riskScore: number;
};
export declare function getMonographStaleness(repoPath: string): Promise<{
    isStale: boolean;
    lastCommit: string | null;
    currentHead: string | null;
    commitsBehind: number;
    changedFiles: string[];
    firstDivergingCommitTime?: string;
}>;
export declare function runDoctor(repoPath: string): Promise<{
    healthy: boolean;
    checks: {
        name: string;
        status: 'ok' | 'warn' | 'fail';
        message: string;
    }[];
}>;
export declare function getProcessesResource(db: Db): {
    processes: {
        id: string;
        name: string;
        steps: {
            id: string;
            name: string;
            filePath: string | null;
        }[];
    }[];
};
export declare function getCommunitiesResource(db: Db): {
    communities: {
        id: number;
        label: string;
        size: number;
        cohesionScore: number | null;
        members: string[];
    }[];
};
export declare function getSchemaResource(db: Db): {
    labels: string[];
    relations: string[];
    nodeCount: number;
    edgeCount: number;
    communityCount: number;
};
export declare function getGraphResource(db: Db): {
    nodes: unknown[];
    edges: unknown[];
    capturedAt: string;
};
export declare function getMonographCypher(db: Db, query: string): {
    rows: Record<string, unknown>[];
    error?: string;
    queryTime: number;
};
export declare function augmentContext(opts: {
    query: string;
    repoPath: string;
    topK?: number;
    format?: 'markdown' | 'json';
}): Promise<string>;
export declare function injectAiContext(opts: {
    repoPath: string;
    targets?: Array<'claude' | 'agents-md'>;
}): Promise<{
    updated: string[];
}>;
export declare function getToolMap(db: Db, opts: {
    tool?: string;
}): {
    tool: string;
    handler: string | null;
    filePath: string | null;
    line: number | null;
}[];
export declare function getShapeCheck(db: Db, _repoPath: string, opts: {
    route?: string;
    file?: string;
}): {
    mismatches: {
        route: string;
        producerKeys: string[];
        consumerKeys: string[];
        missing: string[];
    }[];
    checked: number;
    ok: boolean;
};
export declare function generateSkillFiles(repoPath: string, outputDir?: string): Promise<{
    communityCount: number;
    filesWritten: string[];
}>;
export declare function installSkillsForPlatform(repoPath: string, communities: Array<{
    name: string;
    symbols: string[];
}>, opts: {
    platform: 'claude' | 'cursor' | 'vscode' | 'zed';
}): Promise<{
    platform: string;
    outputDir: string;
    filesWritten: string[];
}>;
export declare function runEmbed(_db: Db, _opts: {
    codeOnly?: boolean;
    force?: boolean;
}): Promise<{
    model: string;
    embedded: number;
    skipped: number;
}>;
export declare function getGroupList(configPath: string): Promise<{
    repo: string;
    path: string;
    nodeCount: number;
    indexedAt: string | null;
}[]>;
export declare function runGroupQuery(configPath: string, query: string, limit?: number): Promise<{
    id: string;
    name: string;
    label: string;
    filePath: string | null;
    repo: string;
    score: number;
}[]>;
export declare function runGroupSync(configPath: string): Promise<{
    repos: number;
    contracts: number;
    written: string[];
}>;
export declare function getGroupContracts(configPath: string): Promise<{
    groupName: string;
    symbol: string;
    filePath: string | null;
    line: number | null;
}[]>;
export declare function getGroupStatus(configPath: string): Promise<{
    totalGroups: number;
    indexedGroups: number;
    stalledGroups: number;
    groups: {
        name: string;
        indexed: boolean;
        stale: boolean;
        contractCount: number;
        lastSync?: string;
    }[];
}>;
export declare function serveMonograph(opts: {
    port?: number;
    open?: boolean;
    db: Db;
}): Promise<{
    status: 'started' | 'already_running';
    url: string;
}>;
export declare function getWikiToolResult(_db: Db, _opts: {
    communityId?: string;
}): {
    pages: Array<{
        communityId: string;
        title: string;
        markdown: string;
    }>;
    note?: string;
};
export declare function runWikiBuildTool(_db: Db, _opts: {
    communityId?: string;
    force?: boolean;
    model?: string;
}): Promise<{
    generated: number;
    skipped: number;
    note: string;
}>;
export declare function listRepos(): {
    name: string;
    path: string;
    lastIndexed?: string;
    nodeCount?: number;
    edgeCount?: number;
}[];
export {};
//# sourceMappingURL=monograph-compat.d.ts.map