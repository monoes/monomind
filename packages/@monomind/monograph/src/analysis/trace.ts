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

interface GraphNode {
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

export function traceExport(graph: Graph, file: string, exportName: string): ExportTrace {
  // Find nodes in the target file matching exportName
  const targetNodes = graph.nodes.filter(
    (n) => n.filePath === file && n.name === exportName,
  );
  const targetIds = new Set(targetNodes.map((n) => n.id));

  // Find CALLS or IMPORTS edges pointing to these nodes from other files
  const directReferences: ReferenceLocation[] = [];
  const reExportChains: ReExportChain[] = [];

  for (const edge of graph.edges) {
    if (!targetIds.has(edge.targetId)) continue;

    const sourceNode = graph.nodes.find((n) => n.id === edge.sourceId);
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

export function traceFile(graph: Graph, file: string): FileTrace {
  // Find all nodes in this file
  const fileNodes = graph.nodes.filter((n) => n.filePath === file);
  const fileNodeIds = new Set(fileNodes.map((n) => n.id));

  // Build exports list
  const exports = fileNodes
    .filter((n) => n.isExported)
    .map((n) => {
      // Check if any external node references this node
      const hasReferences = graph.edges.some(
        (e) =>
          e.targetId === n.id &&
          (e.relation === 'CALLS' || e.relation === 'IMPORTS') &&
          !fileNodeIds.has(e.sourceId),
      );
      return {
        name: n.name,
        isUsed: hasReferences,
        line: n.startLine ?? 0,
      };
    });

  // Find files this file imports from (outgoing IMPORTS edges from file nodes)
  const importsFromSet = new Set<string>();
  for (const edge of graph.edges) {
    if (!fileNodeIds.has(edge.sourceId)) continue;
    if (edge.relation !== 'IMPORTS') continue;
    const targetNode = graph.nodes.find((n) => n.id === edge.targetId);
    if (targetNode?.filePath && targetNode.filePath !== file) {
      importsFromSet.add(targetNode.filePath);
    }
  }

  // Find files that import this file (incoming IMPORTS edges to file nodes)
  const importedBySet = new Set<string>();
  for (const edge of graph.edges) {
    if (!fileNodeIds.has(edge.targetId)) continue;
    if (edge.relation !== 'IMPORTS') continue;
    const sourceNode = graph.nodes.find((n) => n.id === edge.sourceId);
    if (sourceNode?.filePath && sourceNode.filePath !== file) {
      importedBySet.add(sourceNode.filePath);
    }
  }

  // Find re-exports (RE_EXPORTS edges going out from file nodes)
  const reExports: Array<{ name: string; fromFile: string }> = [];
  for (const edge of graph.edges) {
    if (!fileNodeIds.has(edge.sourceId)) continue;
    if (edge.relation !== 'RE_EXPORTS') continue;
    const sourceNode = graph.nodes.find((n) => n.id === edge.sourceId);
    const targetNode = graph.nodes.find((n) => n.id === edge.targetId);
    if (sourceNode && targetNode?.filePath) {
      reExports.push({
        name: sourceNode.name,
        fromFile: targetNode.filePath,
      });
    }
  }

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
