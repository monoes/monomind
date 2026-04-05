// Confidence levels for graph edges — matches graphify's audit trail
export type Confidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

// Node file types
export type FileType = 'code' | 'document' | 'paper' | 'image' | 'unknown';

// Node in the knowledge graph
export interface GraphNode {
  id: string;
  label: string;
  fileType: FileType;
  sourceFile: string;
  sourceLocation?: string;  // e.g. "L42"
  community?: number;
  degree?: number;
  // Extra attributes for specific node types
  [key: string]: unknown;
}

// Edge in the knowledge graph
export interface GraphEdge {
  source: string;
  target: string;
  relation: string;         // 'calls', 'imports', 'uses', 'contains', 'implements', etc.
  confidence: Confidence;
  confidenceScore?: number; // 0.0-1.0 for INFERRED edges
  sourceFile?: string;
  sourceLocation?: string;
  weight?: number;
}

// Raw extraction result from a single file or set of files
export interface ExtractionResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hyperedges?: HyperEdge[];
  filesProcessed: number;
  fromCache: number;
  errors: string[];
}

// Hyperedge (group relationship)
export interface HyperEdge {
  label: string;
  nodes: string[];
  confidence: Confidence;
  confidenceScore?: number;
}

// Graph analysis result
export interface GraphAnalysis {
  godNodes: GodNode[];
  surprises: SurpriseEdge[];
  communities: Record<number, string[]>;
  stats: GraphStats;
}

export interface GodNode {
  id: string;
  label: string;
  degree: number;
  community?: number;
  sourceFile: string;
  neighbors: string[];
}

export interface SurpriseEdge {
  from: string;
  fromCommunity: number;
  fromFile: string;
  to: string;
  toCommunity: number;
  toFile: string;
  relation: string;
  confidence: Confidence;
  score: number;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  communities: number;
  confidence: Record<Confidence, number>;
  fileTypes: Record<string, number>;
  topRelations: Record<string, number>;
  isDirected: boolean;
  graphPath?: string;
}

// Serialized graph format (JSON-compatible)
export interface SerializedGraph {
  version: string;
  builtAt: string;
  projectPath: string;
  nodes: Array<{ id: string } & Record<string, unknown>>;
  links: Array<{ source: string; target: string } & Record<string, unknown>>;
  directed: boolean;
  multigraph: boolean;
}

// Build options
export interface BuildOptions {
  codeOnly?: boolean;
  outputDir?: string;        // defaults to <projectPath>/.monobrain/graph/
  maxFileSizeBytes?: number; // defaults to 500KB
  excludePatterns?: string[];
  languages?: string[];
}

// File classification
export interface ClassifiedFile {
  path: string;
  fileType: FileType;
  language?: string;
  sizeBytes: number;
}

export interface GraphQuestion {
  type: 'AMBIGUOUS_EDGE' | 'BRIDGE_NODE' | 'INFERRED_GOD_NODE' | 'ISOLATED_NODE' | 'LOW_COHESION_COMMUNITY';
  question: string;
  nodes: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface GraphDiff {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: Array<{ source: string; target: string; relation: string }>;
  removedEdges: Array<{ source: string; target: string; relation: string }>;
  communityChanges: Array<{ node: string; oldCommunity: number; newCommunity: number }>;
}
