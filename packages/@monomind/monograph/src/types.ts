import { createHash } from 'node:crypto';

// ── Node labels ───────────────────────────────────────────────────────────────

export type NodeLabel =
  | 'File'
  | 'Folder'
  | 'Function'
  | 'Class'
  | 'Method'
  | 'Interface'
  | 'Variable'
  | 'Struct'
  | 'Enum'
  | 'Macro'
  | 'Typedef'
  | 'Union'
  | 'Namespace'
  | 'Trait'
  | 'Impl'
  | 'TypeAlias'
  | 'Const'
  | 'Static'
  | 'Property'
  | 'Record'
  | 'Delegate'
  | 'Annotation'
  | 'Constructor'
  | 'Template'
  | 'Module'
  | 'Process'
  | 'Route'
  | 'Community'
  | 'Concept'
  | 'Section'
  | 'Document'
  | 'Tool'
  | 'Entity'
  | 'Field';

export const SYMBOL_NODE_LABELS = new Set<NodeLabel>([
  'Function',
  'Class',
  'Method',
  'Interface',
  'Variable',
  'Struct',
  'Enum',
  'Macro',
  'Typedef',
  'Union',
  'Namespace',
  'Trait',
  'Impl',
  'TypeAlias',
  'Const',
  'Static',
  'Property',
  'Record',
  'Delegate',
  'Annotation',
  'Constructor',
  'Template',
  'Module',
]);

// ── Edge relations ────────────────────────────────────────────────────────────

export type EdgeRelation =
  | 'CONTAINS'
  | 'DEFINES'
  | 'CALLS'
  | 'IMPORTS'
  | 'RE_EXPORTS'
  | 'EXTENDS'
  | 'IMPLEMENTS'
  | 'HAS_METHOD'
  | 'HAS_PROPERTY'
  | 'ACCESSES'
  | 'METHOD_OVERRIDES'
  | 'METHOD_IMPLEMENTS'
  | 'MEMBER_OF'
  | 'STEP_IN_PROCESS'
  | 'HANDLES_ROUTE'
  | 'FETCHES'
  | 'HANDLES_TOOL'
  | 'ENTRY_POINT_OF'
  | 'WRAPS'
  | 'QUERIES'
  | 'REFERENCES'
  | 'PARENT_SECTION'
  | 'TAGGED_AS'
  | 'HAS_FIELD'
  // Doc KG — contextual proximity
  | 'CO_OCCURS'
  // Doc KG — LLM-inferred semantic relations
  | 'DESCRIBES'
  | 'CAUSES'
  | 'CONTRASTS_WITH'
  | 'PART_OF'
  | 'RELATED_TO'
  | 'USES'
  | 'STRUCTURALLY_SIMILAR';

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

// ── Evidence ──────────────────────────────────────────────────────────────────

export interface EvidenceEntry {
  kind: string; // e.g., 'import', 'call', 'heuristic', 'inferred'
  weight: number; // 0-1
  note?: string; // human-readable explanation
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
  reason?: string;
  evidence?: EvidenceEntry[];
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
  coverage: number; // 0-1
  score: number; // CC² × (1-coverage)³ + CC
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
  | { type: 'low_cohesion'; community: MonographCommunity }
  | { type: 'no_signal'; edge: MonographEdge; reason: string }
  | { type: 'thin_community'; communityId: number; memberCount: number; reason: string };

// ── Finding actions (structured remediation steps) ────────────────────────────

export type FindingActionType =
  | 'investigate' // read/understand the file
  | 'refactor' // reduce complexity or coupling
  | 'delete' // safe to remove
  | 'add-test' // add test coverage
  | 'add-import' // add missing import edge
  | 'extract' // extract to separate module
  | 'review' // human review required
  | 'add-edge'; // add explicit graph relationship

export interface FindingAction {
  type: FindingActionType;
  file?: string; // target file path
  symbol?: string; // specific symbol/export name
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

// ── Symbol identity ───────────────────────────────────────────────────────────

/**
 * Version of the symbol identity scheme implemented by `symbolId`.
 *
 * Bump this whenever the derivation changes, so that anything caching extraction
 * results keyed by symbol ID can detect that stored IDs are stale and rebuild.
 * Version 1 was the pre-`symbolId` scheme (`makeId(mangledPath, name, kind)`),
 * which collided across files whose paths differed only in punctuation and
 * across same-named symbols in different lexical scopes within one file.
 */
export const SYMBOL_ID_VERSION = 2;

export interface SymbolIdParts {
  /** Exact repository-relative path (e.g. `src/a-b.ts`), used verbatim. */
  filePath: string;
  /** Enclosing lexical scope names, outermost first (e.g. `['First']`). */
  scope: readonly string[];
  /** Symbol name as written in the source. */
  name: string;
  /** Symbol kind — the node label (e.g. `Method`). */
  kind: string;
  /** Discriminator for otherwise-identical declarations (overloads). 0 = first. */
  overload?: number;
}

/**
 * Build a collision-free ID for a code symbol.
 *
 * Every component is length-prefixed before hashing, so the serialization is
 * injective: no component's content can masquerade as a delimiter or bleed into
 * a neighbouring component, and no two distinct `SymbolIdParts` can produce the
 * same input string. Path punctuation, lexical scope, kind, and overload index
 * are therefore all preserved rather than normalized away.
 *
 * The result is restricted to `[a-z0-9_]` and never starts or ends with `_`, so
 * that `makeId` — which callers use to derive edge IDs from node IDs — is the
 * identity function on it and cannot re-introduce the collisions this function
 * exists to prevent.
 *
 * The ID also keeps the `_<kind>` suffix the previous scheme ended with, because
 * relationship resolution disambiguates same-name call targets by testing for
 * `_method` / `_function` / `_class` on the ID (see
 * `pipeline/phases/scope-resolution.ts`). Preserving the suffix keeps that
 * working; it is not a substitute for reading the node's `label` column.
 */
export function symbolId(parts: SymbolIdParts): string {
  const components = [
    String(SYMBOL_ID_VERSION),
    parts.filePath,
    String(parts.scope.length),
    ...parts.scope,
    parts.name,
    parts.kind,
    String(parts.overload ?? 0),
  ];
  const canonical = components.map((c) => `${Buffer.byteLength(c, 'utf8')}:${c}`).join('');
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32);
  return `sym_${symbolIdSlug(parts.name)}_${digest}_${symbolIdSlug(parts.kind)}`;
}

/** Human-readable, `makeId`-stable prefix so IDs stay debuggable in logs. */
function symbolIdSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  return slug || 'anon';
}

// ── Norm label ────────────────────────────────────────────────────────────────

export function toNormLabel(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
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
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MonographError';
  }
}
