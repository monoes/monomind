export type TraceReason = 'no_references' | 'only_re_exported' | 'self_import' | 'has_references';

export interface ReferenceLocation {
  filePath: string;
  line: number;
  col: number;
}

export interface ReExportChain {
  path: string;
  exportName: string;
}

export interface ExportTrace {
  file: string;
  exportName: string;
  isUsed: boolean;
  directReferences: ReferenceLocation[];
  reExportChains: ReExportChain[];
  reason: TraceReason;
}

export interface FileTrace {
  file: string;
  exports: Array<{ name: string; isUsed: boolean; line: number }>;
  importsFrom: string[];
  importedBy: string[];
  reExports: Array<{ name: string; fromFile: string }>;
}

export interface DependencyTrace {
  packageName: string;
  directImporters: string[];
  transitiveImporters: string[];
  isUsed: boolean;
}

export interface CloneInstance {
  filePath: string;
  startLine: number;
  endLine: number;
  similarity: number;
}

export interface CloneTrace {
  sourceFile: string;
  sourceLine: number;
  matchingInstances: CloneInstance[];
  groupId?: number;
}

export interface GraphNode {
  id: string;
  filePath?: string;
  name: string;
  isExported: boolean;
  startLine?: number;
}

interface GraphEdge {
  sourceId: string;
  targetId: string;
  relation: string;
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Build an O(1) id→node index. Pass to the trace functions when calling multiple times on the same graph. */
export function buildNodeIndex(graph: Graph): Map<string, GraphNode> {
  const index = new Map<string, GraphNode>();
  for (const n of graph.nodes) index.set(n.id, n);
  return index;
}

export function traceExport(
  graph: Graph,
  file: string,
  exportName: string,
  nodeIndex?: Map<string, GraphNode>,
): ExportTrace {
  // Build index once if not supplied — O(N) amortised when caller reuses it
  const idx = nodeIndex ?? buildNodeIndex(graph);

  // Find nodes in the target file matching exportName
  const targetIds = new Set<string>();
  for (const n of graph.nodes) {
    if (n.filePath === file && n.name === exportName) targetIds.add(n.id);
  }

  // Find CALLS or IMPORTS edges pointing to these nodes from other files
  const directReferences: ReferenceLocation[] = [];
  const reExportChains: ReExportChain[] = [];

  for (const edge of graph.edges) {
    if (!targetIds.has(edge.targetId)) continue;

    const sourceNode = idx.get(edge.sourceId);
    if (!sourceNode) continue;

    // Skip self-references (same file)
    if (sourceNode.filePath === file) continue;

    if (edge.relation === 'CALLS' || edge.relation === 'IMPORTS') {
      directReferences.push({
        filePath: sourceNode.filePath ?? sourceNode.id,
        line: sourceNode.startLine ?? 0,
        col: 0,
      });
    } else if (edge.relation === 'RE_EXPORTS') {
      reExportChains.push({
        path: sourceNode.filePath ?? sourceNode.id,
        exportName: sourceNode.name,
      });
    }
  }

  // Determine reason
  let reason: TraceReason;
  let isUsed: boolean;

  if (directReferences.length > 0) {
    reason = 'has_references';
    isUsed = true;
  } else if (reExportChains.length > 0) {
    reason = 'only_re_exported';
    isUsed = false;
  } else {
    reason = 'no_references';
    isUsed = false;
  }

  return {
    file,
    exportName,
    isUsed,
    directReferences,
    reExportChains,
    reason,
  };
}

export function traceFile(
  graph: Graph,
  file: string,
  nodeIndex?: Map<string, GraphNode>,
): FileTrace {
  // Build index once if not supplied
  const idx = nodeIndex ?? buildNodeIndex(graph);

  // Find all nodes in this file
  const fileNodes = graph.nodes.filter((n) => n.filePath === file);
  const fileNodeIds = new Set(fileNodes.map((n) => n.id));

  // Pre-compute which target node ids have external references in one edge pass
  // to avoid O(exported_nodes * edges) in the map below.
  const externallyReferenced = new Set<string>();
  const importsFromSet = new Set<string>();
  const importedBySet = new Set<string>();
  const reExports: Array<{ name: string; fromFile: string }> = [];

  for (const edge of graph.edges) {
    const srcInFile = fileNodeIds.has(edge.sourceId);
    const tgtInFile = fileNodeIds.has(edge.targetId);

    if (edge.relation === 'IMPORTS') {
      if (srcInFile) {
        const targetNode = idx.get(edge.targetId);
        if (targetNode?.filePath && targetNode.filePath !== file) {
          importsFromSet.add(targetNode.filePath);
        }
      }
      if (tgtInFile) {
        const sourceNode = idx.get(edge.sourceId);
        if (sourceNode?.filePath && sourceNode.filePath !== file) {
          importedBySet.add(sourceNode.filePath);
        }
      }
      // External IMPORTS into a file node → that node is externally referenced
      if (tgtInFile && !srcInFile) {
        externallyReferenced.add(edge.targetId);
      }
    }

    if (edge.relation === 'CALLS' && tgtInFile && !srcInFile) {
      externallyReferenced.add(edge.targetId);
    }

    if (edge.relation === 'RE_EXPORTS' && srcInFile) {
      const sourceNode = idx.get(edge.sourceId);
      const targetNode = idx.get(edge.targetId);
      if (sourceNode && targetNode?.filePath) {
        reExports.push({ name: sourceNode.name, fromFile: targetNode.filePath });
      }
    }
  }

  // Build exports list using pre-computed set — O(exported_nodes) not O(exported_nodes * edges)
  const exports = fileNodes
    .filter((n) => n.isExported)
    .map((n) => ({
      name: n.name,
      isUsed: externallyReferenced.has(n.id),
      line: n.startLine ?? 0,
    }));

  return {
    file,
    exports,
    importsFrom: Array.from(importsFromSet),
    importedBy: Array.from(importedBySet),
    reExports,
  };
}

export function traceDependency(
  importEdges: Array<{ sourceFile: string; targetPackage: string }>,
  packageName: string,
): DependencyTrace {
  // Find direct importers
  const directImporters = importEdges
    .filter((e) => e.targetPackage === packageName)
    .map((e) => e.sourceFile);

  const directSet = new Set(directImporters);

  // BFS to find transitive importers
  // Build a file→files-it-imports map for internal files
  const fileImports = new Map<string, Set<string>>();
  for (const edge of importEdges) {
    if (!fileImports.has(edge.sourceFile)) {
      fileImports.set(edge.sourceFile, new Set());
    }
  }

  // Build a reverse map: file → files that import it
  const importedBy = new Map<string, Set<string>>();
  for (const edge of importEdges) {
    if (!importedBy.has(edge.sourceFile)) {
      importedBy.set(edge.sourceFile, new Set());
    }
    // We track which files import this package, then who imports those files
  }

  // For transitive: BFS from direct importers outward through reverse import graph
  // We need: who imports the direct importers (via internal imports)
  // Build reverse internal-import map from edges where targetPackage looks like a file path
  const reverseImportMap = new Map<string, Set<string>>();
  for (const edge of importEdges) {
    if (!reverseImportMap.has(edge.targetPackage)) {
      reverseImportMap.set(edge.targetPackage, new Set());
    }
    reverseImportMap.get(edge.targetPackage)!.add(edge.sourceFile);
  }

  const transitiveSet = new Set<string>();
  const queue = [...directImporters];
  const visited = new Set(directImporters);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const upstream = reverseImportMap.get(current);
    if (upstream) {
      for (const file of upstream) {
        if (!visited.has(file) && !directSet.has(file)) {
          visited.add(file);
          transitiveSet.add(file);
          queue.push(file);
        }
      }
    }
  }

  return {
    packageName,
    directImporters,
    transitiveImporters: Array.from(transitiveSet),
    isUsed: directImporters.length > 0 || transitiveSet.size > 0,
  };
}

export function traceClone(
  cloneGroups: Array<{ id: number; instances: CloneInstance[] }>,
  file: string,
  line: number,
): CloneTrace {
  // Find groups containing an instance at (file, line)
  const matchingGroups = cloneGroups.filter((group) =>
    group.instances.some(
      (inst) =>
        inst.filePath === file && inst.startLine <= line && inst.endLine >= line,
    ),
  );

  if (matchingGroups.length === 0) {
    return {
      sourceFile: file,
      sourceLine: line,
      matchingInstances: [],
      groupId: undefined,
    };
  }

  // Use the first matching group
  const group = matchingGroups[0];

  // Return all OTHER instances (not the source one)
  const matchingInstances = group.instances.filter(
    (inst) => !(inst.filePath === file && inst.startLine <= line && inst.endLine >= line),
  );

  return {
    sourceFile: file,
    sourceLine: line,
    matchingInstances,
    groupId: group.id,
  };
}
