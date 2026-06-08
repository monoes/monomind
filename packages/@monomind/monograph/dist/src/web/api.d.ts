import type { Application } from 'express';
import type Database from 'better-sqlite3';
export interface ApiNode {
    id: string;
    name: string;
    label: string;
    filePath: string | null;
    startLine: number | null;
    endLine: number | null;
    communityId: number | null;
}
export interface ApiEdge {
    sourceId: string;
    targetId: string;
    relation: string;
    confidenceScore: number;
}
export interface GraphData {
    nodes: ApiNode[];
    edges: ApiEdge[];
    communities: Record<string, string[]>;
}
export interface NodeDetail {
    node: ApiNode | null;
    callers: ApiNode[];
    callees: ApiNode[];
}
export interface StatsData {
    nodeCount: number;
    edgeCount: number;
    communityCount: number;
    buildAt: string | null;
}
export declare function rowToApiNode(row: Record<string, unknown>): ApiNode;
export declare function queryGraphData(db: Database.Database): GraphData;
export declare function queryNode(db: Database.Database, id: string): NodeDetail;
export declare function querySearch(db: Database.Database, q: string): ApiNode[];
export declare function queryStats(db: Database.Database): StatsData;
export interface GrepResult {
    id: string;
    name: string;
    label: string;
    filePath: string | null;
    startLine: number | null;
}
export declare function queryGrep(db: Database.Database, pattern: string, caseSensitive: boolean): GrepResult[];
export interface FileLine {
    number: number;
    content: string;
}
export interface FileContent {
    path: string;
    totalLines: number;
    lines: FileLine[];
}
export declare function readFileContent(filePath: string, startLine?: number, endLine?: number): FileContent;
export interface ClusterSummary {
    id: number;
    label: string | null;
    memberCount: number;
}
export interface ClusterDetail {
    id: number;
    label: string | null;
    members: unknown[];
}
export declare function queryClusters(db: Database.Database): ClusterSummary[];
export declare function queryCluster(db: Database.Database, name: string): ClusterDetail | null;
export interface ProcessSummary {
    id: string;
    name: string;
    filePath: string | null;
}
export declare function queryProcessesList(db: Database.Database): ProcessSummary[];
export declare function queryProcess(db: Database.Database, name: string): Record<string, unknown> | null;
export interface ServerInfo {
    name: string;
    version: string;
    nodeVersion: string;
    uptimeSeconds: number;
}
export declare function getServerInfo(): ServerInfo;
export declare function streamGraph(db: Database.Database, onRecord: (record: unknown) => void): Promise<void>;
export declare function setupApiRoutes(app: Application, db: Database.Database): void;
//# sourceMappingURL=api.d.ts.map