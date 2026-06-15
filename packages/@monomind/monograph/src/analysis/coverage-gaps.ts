import type { MonographDb } from '../storage/db.js';

export interface UntestedFile {
  nodeId: string;
  filePath: string;
  reachabilityRole: string;   // 'runtime'
  inDegree: number;           // from runtime files
  reason: string;             // e.g. 'No test imports this file'
}

export interface UntestedExport {
  nodeId: string;
  name: string;
  filePath: string | null;
  startLine: number | null;
  exportType: string;   // label
}

export interface CoverageGapsResult {
  untestedFiles: UntestedFile[];
  untestedExports: UntestedExport[];
  fileCoveragePct: number;     // (runtime files reachable by tests) / (total runtime files) * 100
  exportCoveragePct: number;
  summary: string;
}

interface FileRow {
  id: string;
  file_path: string;
}

interface ImportEdgeRow {
  source_id: string;
  target_id: string;
}

interface ExportRow {
  id: string;
  name: string;
  file_path: string | null;
  start_line: number | null;
  label: string;
}

interface InDegreeRow {
  target_id: string;
  cnt: number;
}

export function computeCoverageGaps(db: MonographDb): CoverageGapsResult {
  // Runtime-reachable files
  const runtimeFiles = db.prepare(
    `SELECT id, file_path FROM nodes
     WHERE label = 'File'
       AND json_extract(properties, '$.reachabilityRole') = 'runtime'`
  ).all() as FileRow[];

  // Test entry points
  const testFiles = db.prepare(
    `SELECT id, file_path FROM nodes
     WHERE label = 'File'
       AND json_extract(properties, '$.reachabilityRole') = 'test'`
  ).all() as FileRow[];

  // All IMPORTS edges between files for BFS
  const allImportEdges = db.prepare(
    `SELECT e.source_id, e.target_id
     FROM edges e
     WHERE e.relation IN ('IMPORTS', 'RE_EXPORTS')
       AND e.source_id IN (SELECT id FROM nodes WHERE label = 'File')
       AND e.target_id IN (SELECT id FROM nodes WHERE label = 'File')`
  ).all() as ImportEdgeRow[];

  // Build forward adjacency for BFS
  const forwardAdj = new Map<string, string[]>();
  for (const edge of allImportEdges) {
    let list = forwardAdj.get(edge.source_id);
    if (!list) {
      list = [];
      forwardAdj.set(edge.source_id, list);
    }
    list.push(edge.target_id);
  }

  // BFS from test entry points
  const testReachable = new Set<string>();
  const queue: string[] = [];
  for (const tf of testFiles) {
    if (!testReachable.has(tf.id)) {
      testReachable.add(tf.id);
      queue.push(tf.id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const neighbors = forwardAdj.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!testReachable.has(neighbor)) {
        testReachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Compute in-degree from runtime files only (not test files) so fan-in reflects
  // real dependency weight, not test coverage depth.
  const runtimeFileIdSet = new Set(runtimeFiles.map(rf => rf.id));
  const inDegreeMap = new Map<string, number>();
  for (const edge of allImportEdges) {
    if (!runtimeFileIdSet.has(edge.source_id)) continue;
    const current = inDegreeMap.get(edge.target_id) ?? 0;
    inDegreeMap.set(edge.target_id, current + 1);
  }

  // Untested files = runtime files NOT in the test-reachable set
  const untestedFiles: UntestedFile[] = [];
  for (const rf of runtimeFiles) {
    if (!testReachable.has(rf.id)) {
      untestedFiles.push({
        nodeId: rf.id,
        filePath: rf.file_path,
        reachabilityRole: 'runtime',
        inDegree: inDegreeMap.get(rf.id) ?? 0,
        reason: 'No test imports this file',
      });
    }
  }

  // All exported symbols
  const allExportedRows = db.prepare(
    `SELECT n.id, n.name, n.file_path, n.start_line, n.label
     FROM nodes n
     WHERE n.is_exported = 1
       AND n.label IN ('Function','Class','Method','Interface','Const','TypeAlias','Enum','Variable')`
  ).all() as ExportRow[];

  // Runtime file IDs set for quick lookup
  const runtimeFileIds = new Set(runtimeFiles.map(rf => rf.id));

  // Map file_path -> file node id for runtime files
  const runtimeFilePathToId = new Map<string, string>();
  for (const rf of runtimeFiles) {
    runtimeFilePathToId.set(rf.file_path, rf.id);
  }

  // Determine which file a symbol belongs to (by file_path)
  const testedRuntimeFileIds = new Set<string>();
  for (const rf of runtimeFiles) {
    if (testReachable.has(rf.id)) {
      testedRuntimeFileIds.add(rf.id);
    }
  }

  const untestedExports: UntestedExport[] = [];
  let totalRuntimeExports = 0;
  let testedRuntimeExports = 0;

  for (const exp of allExportedRows) {
    if (!exp.file_path) continue;
    const fileId = runtimeFilePathToId.get(exp.file_path);
    if (!fileId) continue; // not a runtime file

    totalRuntimeExports++;
    if (testedRuntimeFileIds.has(fileId)) {
      testedRuntimeExports++;
    } else {
      untestedExports.push({
        nodeId: exp.id,
        name: exp.name,
        filePath: exp.file_path,
        startLine: exp.start_line ?? null,
        exportType: exp.label,
      });
    }
  }

  const totalRuntimeFiles = runtimeFiles.length;
  const testedRuntimeFiles = runtimeFiles.filter(rf => testReachable.has(rf.id)).length;

  const fileCoveragePct = totalRuntimeFiles > 0
    ? (testedRuntimeFiles / totalRuntimeFiles) * 100
    : 100;

  const exportCoveragePct = totalRuntimeExports > 0
    ? (testedRuntimeExports / totalRuntimeExports) * 100
    : 100;

  const summary = [
    `${testedRuntimeFiles}/${totalRuntimeFiles} runtime files reachable by tests`,
    `(${fileCoveragePct.toFixed(1)}% file coverage,`,
    `${exportCoveragePct.toFixed(1)}% export coverage).`,
    untestedFiles.length > 0
      ? `${untestedFiles.length} untested file(s) found.`
      : 'All runtime files are test-reachable.',
  ].join(' ');

  return {
    untestedFiles,
    untestedExports,
    fileCoveragePct,
    exportCoveragePct,
    summary,
  };
}

/** Format CoverageGapsResult as structured text with file:line hints for LLM navigation. */
export function formatCoverageGaps(result: CoverageGapsResult, topN = 20): string {
  const lines: string[] = [result.summary, ''];

  if (result.untestedFiles.length > 0) {
    // Sort untested files by inDegree descending — highest-impact first
    const sorted = [...result.untestedFiles].sort((a, b) => b.inDegree - a.inDegree);
    const shown = sorted.slice(0, topN);
    lines.push(`Top untested files by import-count (${shown.length}/${result.untestedFiles.length} shown):`);
    for (const f of shown) {
      lines.push(`  ${f.filePath}  in-degree:${f.inDegree}`);
    }
    lines.push('');
  }

  if (result.untestedExports.length > 0) {
    // Group untested exports by file
    const byFile = new Map<string, UntestedExport[]>();
    for (const exp of result.untestedExports) {
      const key = exp.filePath ?? '(unknown)';
      let group = byFile.get(key);
      if (!group) { group = []; byFile.set(key, group); }
      group.push(exp);
    }

    lines.push(`Untested exported symbols (${result.untestedExports.length}) grouped by file:`);
    for (const [filePath, exports] of byFile) {
      lines.push(`  ${filePath}`);
      for (const exp of exports) {
        const ref = exp.startLine != null ? `${filePath}:${exp.startLine}` : filePath;
        lines.push(`    ${exp.exportType}  ${exp.name}  (${ref})`);
      }
    }
    lines.push('');
  }

  lines.push('Fix: add tests importing the untested files, or mark files as non-runtime if they are build artifacts.');
  return lines.join('\n').trimEnd();
}
