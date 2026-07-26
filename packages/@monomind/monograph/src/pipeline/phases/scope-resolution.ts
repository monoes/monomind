import { readFileSync } from 'fs';
import { join, extname } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographNode } from '../../types.js';
import { makeId } from '../../types.js';
import type { ParseOutput } from './parse.js';
import type { CallSite } from './call-site-extractors.js';
import { TS_JS_EXTS, CJS_MJS_EXTS, isSupportedExt, extractCallSites, extractConstructorAssignments } from './call-site-extractors.js';
import { buildWorkspacePackageMap, resolveModuleSpecifier, extractImportNames, buildAllImportMapsFromSource, REEXPORT_RE } from './module-resolution.js';

// Re-export for external consumers
export { clearWorkspacePackageMapCache, buildWorkspacePackageMap, resolveModuleSpecifier } from './module-resolution.js';
export { extractGoCallSites, extractJavaCallSites, extractRustCallSites } from './call-site-extractors.js';

// ── Output ────────────────────────────────────────────────────────────────────

export interface ScopeResolutionOutput {
  resolvedEdges: number;
  skippedDynamic: number;
  ambiguous: number;
  reexportEdges: number;
  orphanImportsRemoved: number;
  importsReconstructed: number;
}

// ── Function index ───────────────────────────────────────────────────────────

function buildFunctionIndex(ctx: PipelineContext): {
  byFilePath: Map<string, Map<string, string[]>>;
  nameCounts: Map<string, number>;
} {
  const byFilePath = new Map<string, Map<string, string[]>>();
  const nameCounts = new Map<string, number>();

  if (!ctx.db) return { byFilePath, nameCounts };

  const rows = ctx.db
    .prepare(`SELECT id, name, file_path FROM nodes WHERE label IN ('Function', 'Method', 'Constructor', 'Class') AND file_path IS NOT NULL`)
    .all() as { id: string; name: string; file_path: string }[];

  for (const row of rows) {
    let fileMap = byFilePath.get(row.file_path);
    if (!fileMap) {
      fileMap = new Map();
      byFilePath.set(row.file_path, fileMap);
    }
    let ids = fileMap.get(row.name);
    if (!ids) {
      ids = [];
      fileMap.set(row.name, ids);
    }
    ids.push(row.id);
    nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
  }

  return { byFilePath, nameCounts };
}

/** A callable node with a known line range, used to attribute a call to its caller. */
interface EnclosingSymbol {
  id: string;
  startLine: number;
  endLine: number;
}

/**
 * Line ranges of every callable, grouped by file, innermost-first.
 *
 * Call edges are attributed to the enclosing function rather than the file.
 * Attributing them to the file makes a function appear "used" by its own file
 * purely because it is declared there, which silently disabled dead-export
 * detection: `detectDeadCodeNodes` rejects any candidate with an inbound CALLS
 * edge, and that self-edge always existed.
 */
function buildEnclosingIndex(ctx: PipelineContext): Map<string, EnclosingSymbol[]> {
  const byFile = new Map<string, EnclosingSymbol[]>();
  if (!ctx.db) return byFile;

  const rows = ctx.db
    .prepare(
      `SELECT id, file_path, start_line, end_line FROM nodes
        WHERE label IN ('Function', 'Method', 'Constructor')
          AND file_path IS NOT NULL AND start_line IS NOT NULL AND end_line IS NOT NULL`
    )
    .all() as { id: string; file_path: string; start_line: number; end_line: number }[];

  for (const row of rows) {
    let list = byFile.get(row.file_path);
    if (!list) { list = []; byFile.set(row.file_path, list); }
    list.push({ id: row.id, startLine: row.start_line, endLine: row.end_line });
  }

  // Narrowest range first, so the first containing match is the innermost
  // scope — a call inside a closure belongs to the closure, not the function
  // that happens to wrap it.
  for (const list of byFile.values()) {
    list.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
  }

  return byFile;
}

/** Line-start offsets, for turning a match offset into a 1-based line number. */
function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

function lineAtOffset(lineOffsets: number[], offset: number): number {
  let lo = 0, hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid]! <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * The innermost callable containing `offset`, or null when the call sits at
 * module top level — which is genuinely file-scoped, so the file node stays
 * the correct source for those.
 */
function findEnclosingSymbolId(
  enclosing: EnclosingSymbol[] | undefined,
  lineOffsets: number[],
  offset: number | undefined,
): string | null {
  if (!enclosing || enclosing.length === 0 || offset === undefined) return null;
  const line = lineAtOffset(lineOffsets, offset);
  for (const sym of enclosing) {
    if (line >= sym.startLine && line <= sym.endLine) return sym.id;
  }
  return null;
}

// ── Target resolution ────────────────────────────────────────────────────────

function pickBestId(ids: string[], site: CallSite): string | null {
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) return null;
  const suffix = site.form === 'method' ? '_method' : '_function';
  const match = ids.find(id => id.endsWith(suffix));
  if (!match && site.calleeRaw.startsWith('new ')) {
    const classMatch = ids.find(id => id.endsWith('_class'));
    if (classMatch) return classMatch;
  }
  return match ?? ids[0];
}

function resolveTarget(
  site: CallSite,
  callerFilePath: string,
  importMap: Map<string, string>,
  fnIndex: Map<string, Map<string, string[]>>,
  ctorMap: Map<string, string> | undefined,
  importedFiles: string[],
): { targetId: string } | null {
  const methodName = site.methodName;
  if (!methodName) return null;

  let candidateFilePaths: string[];

  if (site.form === 'method' && site.receiverName) {
    const receiverPath = importMap.get(site.receiverName);
    if (receiverPath) {
      candidateFilePaths = [receiverPath];
    } else {
      const className = ctorMap?.get(site.receiverName);
      const classFilePath = className ? importMap.get(className) : undefined;
      if (classFilePath) {
        candidateFilePaths = [classFilePath, callerFilePath];
      } else {
        const sameFileIds = fnIndex.get(callerFilePath)?.get(methodName);
        if (sameFileIds && sameFileIds.length > 0) {
          return { targetId: pickBestId(sameFileIds, site)! };
        }
        const matches = importedFiles.filter(fp => fnIndex.get(fp)?.has(methodName));
        if (matches.length === 1) {
          const ids = fnIndex.get(matches[0])!.get(methodName)!;
          return { targetId: pickBestId(ids, site)! };
        }
        return null;
      }
    }
  } else if (site.form === 'direct') {
    const importedFrom = importMap.get(methodName);
    if (importedFrom) {
      candidateFilePaths = [importedFrom, callerFilePath];
    } else {
      candidateFilePaths = [callerFilePath, ...importedFiles];
    }
  } else {
    return null;
  }

  for (const fp of candidateFilePaths) {
    const ids = fnIndex.get(fp)?.get(methodName);
    if (ids && ids.length > 0) {
      const best = pickBestId(ids, site);
      if (best) return { targetId: best };
    }
  }

  return null;
}

// ── Edge emission ────────────────────────────────────────────────────────────

interface PreparedEdgeStmts {
  selectExisting: import('better-sqlite3').Statement;
  updateScore: import('better-sqlite3').Statement;
  insertNew: import('better-sqlite3').Statement;
}

function prepareEdgeStmts(db: import('better-sqlite3').Database): PreparedEdgeStmts {
  return {
    selectExisting: db.prepare(
      `SELECT id, confidence_score FROM edges WHERE source_id = ? AND target_id = ? AND relation = 'CALLS'`
    ),
    updateScore: db.prepare(
      `UPDATE edges SET confidence_score = ?, confidence = 'EXTRACTED' WHERE id = ?`
    ),
    insertNew: db.prepare(
      `INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score) VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', ?)`
    ),
  };
}

const RESOLVED_CONFIDENCE_SCORE = 0.75;

function emitEdge(
  stmts: PreparedEdgeStmts,
  sourceId: string,
  targetId: string,
): 'inserted' | 'upgraded' | 'skipped' {
  if (sourceId === targetId) return 'skipped';

  const existing = stmts.selectExisting.get(sourceId, targetId) as { id: string; confidence_score: number } | undefined;

  if (existing) {
    const newScore = Math.max(existing.confidence_score, RESOLVED_CONFIDENCE_SCORE);
    if (newScore > existing.confidence_score) {
      stmts.updateScore.run(newScore, existing.id);
    }
    return 'upgraded';
  }

  const edgeId = makeId(sourceId, targetId, 'calls_resolved');
  try {
    stmts.insertNew.run(edgeId, sourceId, targetId, RESOLVED_CONFIDENCE_SCORE);
    return 'inserted';
  } catch {
    return 'skipped';
  }
}

// ── Phase definition ──────────────────────────────────────────────────────────

function getImportMap(
  allImportMaps: Map<string, Map<string, string>>,
  fileNodeId: string,
): Map<string, string> {
  return allImportMaps.get(fileNodeId) ?? new Map();
}

export const scopeResolutionPhase: PipelinePhase<ScopeResolutionOutput> = {
  name: 'scope-resolution',
  deps: ['parse', 'cross-file'],
  async execute(ctx, deps) {
    if (ctx.allFilesCached) {
      return { resolvedEdges: 0, skippedDynamic: 0, ambiguous: 0, reexportEdges: 0, orphanImportsRemoved: 0, importsReconstructed: 0 };
    }
    const { symbolNodes, fileContents } = deps.get('parse') as ParseOutput;

    let resolvedEdges = 0;
    let skippedDynamic = 0;
    let ambiguous = 0;

    const fileNodesByPath = new Map<string, MonographNode>();
    for (const node of symbolNodes) {
      if (node.label === 'File' && node.filePath) {
        fileNodesByPath.set(node.filePath, node);
      }
    }

    if (ctx.db) {
      const dbFileNodes = ctx.db
        .prepare(`SELECT id, file_path FROM nodes WHERE label = 'File'`)
        .all() as { id: string; file_path: string }[];
      for (const row of dbFileNodes) {
        if (row.file_path && !fileNodesByPath.has(row.file_path)) {
          fileNodesByPath.set(row.file_path, {
            id: row.id,
            label: 'File',
            name: row.file_path.split('/').pop() ?? row.file_path,
            normLabel: '',
            filePath: row.file_path,
            isExported: false,
          });
        }
      }
    }

    const allImportMaps = buildAllImportMapsFromSource(ctx.repoPath, fileNodesByPath, fileContents);
    const { byFilePath: fnIndex, nameCounts } = buildFunctionIndex(ctx);
    const enclosingIndex = buildEnclosingIndex(ctx);

    const edgeStmts = ctx.db ? prepareEdgeStmts(ctx.db) : null;
    const resolveAllCalls = ctx.db?.transaction(() => {
      for (const [filePath, fileNode] of fileNodesByPath) {
        const ext = extname(filePath).toLowerCase();
        if (!isSupportedExt(ext)) continue;

        let source: string | undefined = fileContents.get(filePath);
        if (!source) {
          try {
            source = readFileSync(join(ctx.repoPath, filePath), 'utf-8');
          } catch {
            continue;
          }
        }

        const callSites = extractCallSites(source, filePath, fileNode.id, ext);
        const lineOffsets = buildLineOffsets(source);
        const enclosing = enclosingIndex.get(filePath);
        const importMap = getImportMap(allImportMaps, fileNode.id);
        const ctorMap = (TS_JS_EXTS.has(ext) || CJS_MJS_EXTS.has(ext)) ? extractConstructorAssignments(source) : undefined;
        const importedFiles = [...new Set(importMap.values())];

        for (const site of callSites) {
          if (site.form === 'dynamic') {
            skippedDynamic++;
            continue;
          }

          const resolved = resolveTarget(site, filePath, importMap, fnIndex, ctorMap, importedFiles);
          if (!resolved) continue;

          if (site.methodName && (nameCounts.get(site.methodName) ?? 0) > 1) {
            ambiguous++;
          }

          // Attribute the call to the function it sits in; fall back to the
          // file node for genuine module-top-level calls.
          const sourceId =
            findEnclosingSymbolId(enclosing, lineOffsets, site.offset) ?? site.callerFileNodeId;

          const result = edgeStmts ? emitEdge(edgeStmts, sourceId, resolved.targetId) : 'skipped';
          if (result === 'inserted' || result === 'upgraded') {
            resolvedEdges++;
          }
        }
      }
    });
    resolveAllCalls?.();

    let reexportEdges = 0;
    if (ctx.db) {
      const insertRef = ctx.db.prepare(`
        INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score)
        VALUES (?, ?, ?, 'REFERENCES', 'EXTRACTED', 0.85)
      `);
      const reexportKnownFiles = new Set(fileNodesByPath.keys());
      const reexportWorkspaceMap = buildWorkspacePackageMap(ctx.repoPath);
      const insertReexports = ctx.db.transaction(() => {
        for (const [filePath, fileNode] of fileNodesByPath) {
          const ext = extname(filePath).toLowerCase();
          if (!TS_JS_EXTS.has(ext) && !CJS_MJS_EXTS.has(ext)) continue;

          let source: string | undefined = fileContents.get(filePath);
          if (!source) { try { source = readFileSync(join(ctx.repoPath, filePath), 'utf-8'); } catch { continue; } }

          REEXPORT_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = REEXPORT_RE.exec(source)) !== null) {
            const specifier = m[2];
            const names = extractImportNames(m[1]);
            const resolvedFile = resolveModuleSpecifier(filePath, specifier, ctx.repoPath, reexportKnownFiles, reexportWorkspaceMap);
            if (!resolvedFile) continue;

            for (const name of names) {
              const ids = fnIndex.get(resolvedFile)?.get(name);
              if (!ids || ids.length === 0) continue;
              const targetId = ids.length === 1 ? ids[0] : (ids.find(id => id.endsWith('_function')) ?? ids[0]);
              const edgeId = makeId(fileNode.id, targetId, 'reexport_ref');
              try {
                insertRef.run(edgeId, fileNode.id, targetId);
                reexportEdges++;
              } catch { /* duplicate */ }
            }
          }
        }
      });
      insertReexports();
    }

    let orphanImportsRemoved = 0;
    if (ctx.db) {
      const result = ctx.db
        .prepare(`
          DELETE FROM edges WHERE id IN (
            SELECT e.id FROM edges e
            JOIN nodes t ON e.target_id = t.id
            WHERE e.relation = 'IMPORTS' AND t.label = 'Variable'
          )
        `)
        .run();
      orphanImportsRemoved = result.changes;
    }

    let importsReconstructed = 0;
    if (ctx.db) {
      const insertImport = ctx.db.prepare(`
        INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score)
        VALUES (?, ?, ?, 'IMPORTS', 'EXTRACTED', 0.9)
      `);
      const fileIdByPath = new Map<string, string>();
      for (const [fp, node] of fileNodesByPath) fileIdByPath.set(fp, node.id);

      const insertAll = ctx.db.transaction(() => {
        for (const [fileNodeId, importMap] of allImportMaps) {
          const targetPaths = new Set(importMap.values());
          for (const targetPath of targetPaths) {
            const targetFileId = fileIdByPath.get(targetPath);
            if (!targetFileId || targetFileId === fileNodeId) continue;
            const edgeId = makeId(fileNodeId, targetFileId, 'imports_file');
            try {
              insertImport.run(edgeId, fileNodeId, targetFileId);
              importsReconstructed++;
            } catch { /* duplicate */ }
          }
        }
      });
      insertAll();
    }

    return { resolvedEdges, skippedDynamic, ambiguous, reexportEdges, orphanImportsRemoved, importsReconstructed };
  },
};
