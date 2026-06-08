export type NodeLabel = 'File' | 'Folder' | 'Function' | 'Class' | 'Method' | 'Interface' | 'Variable' | 'Struct' | 'Enum' | 'Macro' | 'Typedef' | 'Union' | 'Namespace' | 'Trait' | 'Impl' | 'TypeAlias' | 'Const' | 'Static' | 'Property' | 'Record' | 'Delegate' | 'Annotation' | 'Constructor' | 'Template' | 'Module' | 'Process' | 'Route' | 'Community' | 'Concept' | 'Section' | 'Document' | 'Tool' | 'Entity' | 'Field';
export declare const SYMBOL_NODE_LABELS: Set<NodeLabel>;
export type EdgeRelation = 'CONTAINS' | 'DEFINES' | 'CALLS' | 'IMPORTS' | 'RE_EXPORTS' | 'EXTENDS' | 'IMPLEMENTS' | 'HAS_METHOD' | 'HAS_PROPERTY' | 'ACCESSES' | 'METHOD_OVERRIDES' | 'METHOD_IMPLEMENTS' | 'MEMBER_OF' | 'STEP_IN_PROCESS' | 'HANDLES_ROUTE' | 'FETCHES' | 'HANDLES_TOOL' | 'ENTRY_POINT_OF' | 'WRAPS' | 'QUERIES' | 'REFERENCES' | 'PARENT_SECTION' | 'TAGGED_AS' | 'HAS_FIELD' | 'CO_OCCURS' | 'DESCRIBES' | 'CAUSES' | 'CONTRASTS_WITH' | 'PART_OF' | 'RELATED_TO' | 'USES' | 'STRUCTURALLY_SIMILAR';
export type EdgeConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
export declare const CONFIDENCE_SCORE: Record<EdgeConfidence, number>;
export interface MonographNode {
    id: string;
    label: NodeLabel;
    name: string;
    normLabel: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    communityId?: number;
    isExported: boolean;
    language?: string;
    reachabilityRole?: 'runtime' | 'test' | 'support' | 'unreachable';
    properties?: Record<string, unknown>;
}
export interface EvidenceEntry {
    kind: string;
    weight: number;
    note?: string;
}
export interface MonographEdge {
    id: string;
    sourceId: string;
    targetId: string;
    relation: EdgeRelation;
    confidence: EdgeConfidence;
    confidenceScore: number;
    weight?: number;
    reason?: string;
    evidence?: EvidenceEntry[];
}
export interface MonographCommunity {
    id: number;
    label?: string;
    size: number;
    cohesionScore: number;
}
export interface GodNode extends MonographNode {
    degree: number;
    inDegree: number;
    outDegree: number;
}
export interface ComplexityMetrics {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    linesOfCode: number;
    paramCount: number;
}
export interface CrapScore {
    cc: number;
    coverage: number;
    score: number;
    risk: 'low' | 'medium' | 'high' | 'critical';
}
export interface SurprisingConnection {
    edge: MonographEdge;
    score: number;
    reasons: string[];
}
export type SuggestedQuestion = {
    type: 'ambiguous_edge';
    edge: MonographEdge;
    reason: string;
} | {
    type: 'bridge_node';
    node: MonographNode;
    commA: number;
    commB: number;
} | {
    type: 'verify_inferred';
    edge: MonographEdge;
    inferredFrom: string;
} | {
    type: 'isolated_nodes';
    nodes: MonographNode[];
    reason: string;
} | {
    type: 'low_cohesion';
    community: MonographCommunity;
} | {
    type: 'no_signal';
    edge: MonographEdge;
    reason: string;
} | {
    type: 'thin_community';
    communityId: number;
    memberCount: number;
    reason: string;
};
export type FindingActionType = 'investigate' | 'refactor' | 'delete' | 'add-test' | 'add-import' | 'extract' | 'review' | 'add-edge';
export interface FindingAction {
    type: FindingActionType;
    file?: string;
    symbol?: string;
    description: string;
    confidence: 'high' | 'medium' | 'low';
}
export interface AnnotatedFinding {
    title: string;
    severity: 'error' | 'warning' | 'info';
    nodeId?: string;
    nodeName?: string;
    filePath?: string | null;
    introduced?: boolean;
    actions: FindingAction[];
}
export declare function makeId(...parts: string[]): string;
export declare function toNormLabel(name: string): string;
export interface PipelineProgress {
    phase: string;
    filesProcessed?: number;
    totalFiles?: number;
    message?: string;
}
export declare class MonographError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
//# sourceMappingURL=types.d.ts.map