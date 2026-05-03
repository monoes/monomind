// ── Node labels ───────────────────────────────────────────────────────────────

export type NodeLabel =
  | 'File' | 'Folder' | 'Function' | 'Class' | 'Method' | 'Interface'
  | 'Variable' | 'Struct' | 'Enum' | 'Macro' | 'Typedef' | 'Union'
  | 'Namespace' | 'Trait' | 'Impl' | 'TypeAlias' | 'Const' | 'Static'
  | 'Property' | 'Record' | 'Delegate' | 'Annotation' | 'Constructor'
  | 'Template' | 'Module' | 'Process' | 'Route' | 'Community' | 'Concept'
  | 'Section';

export const SYMBOL_NODE_LABELS = new Set<NodeLabel>([
  'Function', 'Class', 'Method', 'Interface', 'Variable', 'Struct', 'Enum',
  'Macro', 'Typedef', 'Union', 'Namespace', 'Trait', 'Impl', 'TypeAlias',
  'Const', 'Static', 'Property', 'Record', 'Delegate', 'Annotation',
  'Constructor', 'Template', 'Module',
]);

// ── Edge relations ────────────────────────────────────────────────────────────

export type EdgeRelation =
  | 'CONTAINS' | 'DEFINES' | 'CALLS' | 'IMPORTS' | 'RE_EXPORTS' | 'EXTENDS' | 'IMPLEMENTS'
  | 'HAS_METHOD' | 'HAS_PROPERTY' | 'ACCESSES' | 'METHOD_OVERRIDES'
  | 'METHOD_IMPLEMENTS' | 'MEMBER_OF' | 'STEP_IN_PROCESS' | 'HANDLES_ROUTE'
  | 'FETCHES' | 'HANDLES_TOOL' | 'ENTRY_POINT_OF' | 'WRAPS' | 'QUERIES'
  | 'REFERENCES' | 'PARENT_SECTION' | 'TAGGED_AS'
  // Doc KG — contextual proximity
  | 'CO_OCCURS'
  // Doc KG — LLM-inferred semantic relations
  | 'DESCRIBES' | 'CAUSES' | 'CONTRASTS_WITH' | 'PART_OF' | 'RELATED_TO' | 'USES' | 'STRUCTURALLY_SIMILAR';

// ── Confidence ────────────────────────────────────────────────────────────────

export type EdgeConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export const CONFIDENCE_SCORE: Record<EdgeConfidence, number> = {
  EXTRACTED: 1.0,
  INFERRED: 0.5,
  AMBIGUOUS: 0.2,
};

// ── Nodes ─────────────────────────────────────────────────────────────────────

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

// ── Edges ─────────────────────────────────────────────────────────────────────

export interface MonographEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  confidence: EdgeConfidence;
  confidenceScore: number;
  weight?: number;
}

// ── Communities ───────────────────────────────────────────────────────────────

export interface MonographCommunity {
  id: number;
  label?: string;
  size: number;
  cohesionScore: number;
}

// ── God nodes ─────────────────────────────────────────────────────────────────

export interface GodNode extends MonographNode {
  degree: number;
  inDegree: number;
  outDegree: number;
}

// ── Complexity metrics ────────────────────────────────────────────────────────

export interface ComplexityMetrics {
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  linesOfCode: number;
  paramCount: number;
}

export interface CrapScore {
  cc: number;
  coverage: number;   // 0-1
  score: number;      // CC² × (1-coverage)³ + CC
  risk: 'low' | 'medium' | 'high' | 'critical';
}

// ── Surprising connections ────────────────────────────────────────────────────

export interface SurprisingConnection {
  edge: MonographEdge;
  score: number;
  reasons: string[];
}

// ── Suggested questions ───────────────────────────────────────────────────────

export type SuggestedQuestion =
  | { type: 'ambiguous_edge'; edge: MonographEdge; reason: string }
  | { type: 'bridge_node'; node: MonographNode; commA: number; commB: number }
  | { type: 'verify_inferred'; edge: MonographEdge; inferredFrom: string }
  | { type: 'isolated_nodes'; nodes: MonographNode[]; reason: string }
  | { type: 'low_cohesion'; community: MonographCommunity };

// ── Finding actions (structured remediation steps) ────────────────────────────

export type FindingActionType =
  | 'investigate'     // read/understand the file
  | 'refactor'        // reduce complexity or coupling
  | 'delete'          // safe to remove
  | 'add-test'        // add test coverage
  | 'add-import'      // add missing import edge
  | 'extract'         // extract to separate module
  | 'review'          // human review required
  | 'add-edge';       // add explicit graph relationship

export interface FindingAction {
  type: FindingActionType;
  file?: string;       // target file path
  symbol?: string;     // specific symbol/export name
  description: string; // human-readable instruction
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

// ── ID generation ─────────────────────────────────────────────────────────────

export function makeId(...parts: string[]): string {
  return parts
    .join('_')
    .replace(/[^a-z0-9_]/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

// ── Norm label ────────────────────────────────────────────────────────────────

export function toNormLabel(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ── Pipeline progress ─────────────────────────────────────────────────────────

export interface PipelineProgress {
  phase: string;
  filesProcessed?: number;
  totalFiles?: number;
  message?: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class MonographError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MonographError';
  }
}
