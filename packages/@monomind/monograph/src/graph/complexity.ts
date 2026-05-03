import type { MonographDb } from '../storage/db.js';

export interface FunctionComplexity {
  nodeId: string;
  name: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  cyclomaticComplexity: number;   // decision points + 1
  cognitiveComplexity: number;    // cognitive weight (nesting multiplier)
  linesOfCode: number;
  paramCount: number;
  crapScore: number;              // CC² × (1 - coverage)³ + CC (coverage defaults to 0 when unknown)
}

export interface ComplexityReport {
  functions: FunctionComplexity[];
  p50cc: number;
  p90cc: number;
  p95cc: number;
  highComplexityCount: number;   // CC > 10
  criticalCount: number;          // CC > 20
}

/**
 * Compute CRAP score for a function.
 * Formula: CC² × (1 - coverage)³ + CC
 * where coverage is a 0-1 fraction (0 = no tests, 1 = fully covered).
 */
export function computeCrapScore(cc: number, coverage: number): number {
  const cov = Math.max(0, Math.min(1, coverage));
  return cc * cc * Math.pow(1 - cov, 3) + cc;
}

/**
 * Compute cyclomatic and cognitive complexity for all Function/Method nodes
 * in the knowledge graph. Uses graph degree as a proxy for decision points
 * since AST is not available at this layer.
 *
 * - Cyclomatic complexity proxy: outgoing CALLS × 0.5 + outgoing ACCESSES × 0.2 + 1
 * - Cognitive complexity proxy: (endLine - startLine) / 10, capped at 20
 * - LOC: endLine - startLine + 1 (or 1 if missing)
 * - CRAP: computed with coverage = 0 (worst-case, no test data available)
 */
export function computeComplexity(db: MonographDb): ComplexityReport {
  // Query all function/method nodes
  const rows = db.prepare(`
    SELECT id, name, file_path, start_line, end_line, properties
    FROM nodes
    WHERE label IN ('Function', 'Method')
  `).all() as Array<{
    id: string;
    name: string;
    file_path: string | null;
    start_line: number | null;
    end_line: number | null;
    properties: string | null;
  }>;

  const functions: FunctionComplexity[] = [];

  for (const row of rows) {
    const props = row.properties ? JSON.parse(row.properties) as Record<string, unknown> : {};

    // Outgoing CALLS edges (decision points proxy)
    const callsCount = (db.prepare(`
      SELECT COUNT(*) as c FROM edges
      WHERE source_id = ? AND relation = 'CALLS'
    `).get(row.id) as { c: number }).c;

    // Outgoing ACCESSES edges
    const accessesCount = (db.prepare(`
      SELECT COUNT(*) as c FROM edges
      WHERE source_id = ? AND relation = 'ACCESSES'
    `).get(row.id) as { c: number }).c;

    // Cyclomatic complexity proxy: decision points + 1
    const cyclomaticComplexity = Math.round(callsCount * 0.5 + accessesCount * 0.2 + 1);

    // Cognitive complexity proxy: nesting depth approximation capped at 20
    const lineSpan = (row.start_line != null && row.end_line != null)
      ? row.end_line - row.start_line
      : 0;
    const cognitiveComplexity = Math.min(Math.round(lineSpan / 10), 20);

    // LOC
    const linesOfCode = (row.start_line != null && row.end_line != null)
      ? row.end_line - row.start_line + 1
      : 1;

    // Param count from stored properties
    const paramCount = typeof props.paramCount === 'number' ? props.paramCount : 0;

    // CRAP score with no coverage data (worst-case: coverage = 0)
    const crapScore = computeCrapScore(cyclomaticComplexity, 0);

    // Store computed metrics back onto the node properties
    const updatedProps = {
      ...props,
      cyclomaticComplexity,
      cognitiveComplexity,
      crapScore,
    };
    db.prepare('UPDATE nodes SET properties = ? WHERE id = ?')
      .run(JSON.stringify(updatedProps), row.id);

    functions.push({
      nodeId: row.id,
      name: row.name,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      cyclomaticComplexity,
      cognitiveComplexity,
      linesOfCode,
      paramCount,
      crapScore,
    });
  }

  // Compute percentiles for cyclomatic complexity
  const ccValues = functions.map(f => f.cyclomaticComplexity).sort((a, b) => a - b);
  const len = ccValues.length;

  function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const idx = Math.floor((p / 100) * (arr.length - 1));
    return arr[idx];
  }

  const p50cc = percentile(ccValues, 50);
  const p90cc = percentile(ccValues, 90);
  const p95cc = percentile(ccValues, 95);
  const highComplexityCount = functions.filter(f => f.cyclomaticComplexity > 10).length;
  const criticalCount = functions.filter(f => f.cyclomaticComplexity > 20).length;

  return {
    functions,
    p50cc,
    p90cc,
    p95cc,
    highComplexityCount,
    criticalCount,
  };
}
