import { execSync } from 'child_process';
import type { MonographDb } from './storage/db.js';

export type AuditVerdict = 'Pass' | 'Warn' | 'Fail';
export type AuditGate = 'new-only' | 'all';

export interface AuditAttribution {
  domain: string;            // 'dead-code' | 'complexity' | 'duplication' | 'cycles'
  newCount: number;          // findings introduced by changed files
  inheritedCount: number;    // pre-existing findings in changed files
}

export interface AuditSummary {
  verdict: AuditVerdict;
  changedFiles: number;
  deadCodeIssues: number;
  complexityFindings: number;
  maxCyclomatic: number;
  duplicationCloneGroups: number;
  cycleCount: number;
  attributions: AuditAttribution[];
  gate: AuditGate;
}

interface NodeRow {
  id: string;
  file_path: string | null;
  properties: string | null;
}

interface EdgeRow {
  source_id: string;
  target_id: string;
}

export function runAudit(
  db: MonographDb,
  repoPath: string,
  options?: { changedSince?: string; gate?: AuditGate }
): AuditSummary {
  const gate: AuditGate = options?.gate ?? 'new-only';

  // ── Step 1: Determine changed file set ──────────────────────────────────────
  let changedFilePaths: Set<string> = new Set();
  let useAllFiles = false;

  if (options?.changedSince) {
    try {
      const output = execSync(
        `git diff --name-only ${options.changedSince} HEAD`,
        { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
      ).toString();
      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) changedFilePaths.add(trimmed);
      }
    } catch {
      useAllFiles = true;
    }
  } else {
    useAllFiles = true;
  }

  // ── Step 2: Get all File nodes from DB ──────────────────────────────────────
  const fileNodes = db.prepare(`
    SELECT id, file_path, properties
    FROM nodes
    WHERE label = 'File' AND file_path IS NOT NULL
  `).all() as NodeRow[];

  if (useAllFiles) {
    for (const n of fileNodes) {
      if (n.file_path) changedFilePaths.add(n.file_path);
    }
  }

  // Build a map of file_path → node id for changed files
  const changedNodeIds = new Set<string>();
  const filePathToId = new Map<string, string>();
  for (const n of fileNodes) {
    if (!n.file_path) continue;
    filePathToId.set(n.file_path, n.id);
    // Match by full path or relative suffix
    for (const cp of changedFilePaths) {
      if (n.file_path === cp || n.file_path.endsWith('/' + cp) || n.file_path.endsWith('\\' + cp)) {
        changedNodeIds.add(n.id);
        break;
      }
    }
  }

  const changedFileCount = changedNodeIds.size;

  // ── Step 3: Dead code issues (unreachable files in changed set) ─────────────
  let deadCodeIssues = 0;
  for (const n of fileNodes) {
    if (!changedNodeIds.has(n.id)) continue;
    const props = n.properties ? JSON.parse(n.properties) : {};
    if (props.reachabilityRole === 'unreachable') deadCodeIssues++;
  }

  // ── Step 4: Complexity findings (Symbol nodes in changed files with CC > 10) ─
  let complexityFindings = 0;
  let maxCyclomatic = 0;

  if (changedNodeIds.size > 0) {
    // Get Symbol/Function/Method nodes belonging to changed files
    const symbolRows = db.prepare(`
      SELECT n.id, n.file_path, n.properties
      FROM nodes n
      WHERE n.label IN ('Function', 'Method', 'Symbol')
        AND n.file_path IS NOT NULL
    `).all() as NodeRow[];

    for (const sym of symbolRows) {
      if (!sym.file_path) continue;
      // Check if this symbol belongs to a changed file
      let inChangedFile = false;
      for (const cp of changedFilePaths) {
        if (sym.file_path === cp || sym.file_path.endsWith('/' + cp) || sym.file_path.endsWith('\\' + cp)) {
          inChangedFile = true;
          break;
        }
      }
      if (!inChangedFile) continue;

      const props = sym.properties ? JSON.parse(sym.properties) : {};
      const cc: number = typeof props.cyclomaticComplexity === 'number' ? props.cyclomaticComplexity : 0;
      if (cc > 10) complexityFindings++;
      if (cc > maxCyclomatic) maxCyclomatic = cc;
    }
  }

  // ── Step 5: Clone groups (STRUCTURALLY_SIMILAR edges between changed files) ──
  let duplicationCloneGroups = 0;
  if (changedNodeIds.size > 0) {
    const cloneEdges = db.prepare(`
      SELECT source_id, target_id
      FROM edges
      WHERE relation = 'STRUCTURALLY_SIMILAR'
    `).all() as EdgeRow[];

    for (const edge of cloneEdges) {
      if (changedNodeIds.has(edge.source_id) && changedNodeIds.has(edge.target_id)) {
        duplicationCloneGroups++;
      }
    }
  }

  // ── Step 6: Cycle detection (mutual imports among changed files) ─────────────
  let cycleCount = 0;
  if (changedNodeIds.size > 0) {
    // Build adjacency for changed files
    const importEdges = db.prepare(`
      SELECT source_id, target_id
      FROM edges
      WHERE relation = 'IMPORTS'
    `).all() as EdgeRow[];

    // For a simplified cycle check: count changed files where there's a mutual import
    const importMap = new Map<string, Set<string>>();
    for (const edge of importEdges) {
      if (!importMap.has(edge.source_id)) importMap.set(edge.source_id, new Set());
      importMap.get(edge.source_id)!.add(edge.target_id);
    }

    const counted = new Set<string>();
    for (const nodeId of changedNodeIds) {
      const outgoing = importMap.get(nodeId);
      if (!outgoing) continue;
      for (const target of outgoing) {
        if (counted.has(`${nodeId}:${target}`)) continue;
        // Check if target imports back nodeId
        const targetOutgoing = importMap.get(target);
        if (targetOutgoing?.has(nodeId)) {
          cycleCount++;
          counted.add(`${nodeId}:${target}`);
          counted.add(`${target}:${nodeId}`);
        }
      }
    }
  }

  // ── Step 7: Attributions ─────────────────────────────────────────────────────
  const attributions: AuditAttribution[] = [
    {
      domain: 'dead-code',
      newCount: deadCodeIssues,
      inheritedCount: deadCodeIssues > 0 ? 0 : 0, // heuristic: all new if changed
    },
    {
      domain: 'complexity',
      newCount: complexityFindings,
      inheritedCount: 0,
    },
    {
      domain: 'duplication',
      newCount: duplicationCloneGroups,
      inheritedCount: 0,
    },
    {
      domain: 'cycles',
      newCount: cycleCount,
      inheritedCount: 0,
    },
  ];

  // ── Step 8: Verdict ──────────────────────────────────────────────────────────
  let verdict: AuditVerdict;
  if (deadCodeIssues > 5 || cycleCount > 0) {
    verdict = 'Fail';
  } else if (deadCodeIssues > 0 || complexityFindings > 0 || duplicationCloneGroups > 0) {
    verdict = 'Warn';
  } else {
    verdict = 'Pass';
  }

  return {
    verdict,
    changedFiles: changedFileCount,
    deadCodeIssues,
    complexityFindings,
    maxCyclomatic,
    duplicationCloneGroups,
    cycleCount,
    attributions,
    gate,
  };
}
