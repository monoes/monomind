import { readFileSync } from 'fs';
import { join, extname } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographNode } from '../../types.js';
import { makeId } from '../../types.js';
import type { ParseOutput } from './parse.js';

// ── Output ────────────────────────────────────────────────────────────────────

export interface ScopeResolutionOutput {
  resolvedEdges: number;
  skippedDynamic: number;
  ambiguous: number;
}

// ── Call site ─────────────────────────────────────────────────────────────────

interface CallSite {
  callerFileNodeId: string;
  callerFilePath: string;
  calleeRaw: string;
  form: 'method' | 'direct' | 'dynamic';
  receiverName?: string;
  methodName?: string;
}

// ── JS/TS keywords to skip for direct calls ───────────────────────────────────

const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'return', 'function', 'class', 'new', 'typeof',
  'await', 'catch', 'throw', 'delete', 'void', 'instanceof', 'in', 'of',
  'import', 'export', 'yield', 'async', 'super', 'this', 'const', 'let', 'var',
  'try', 'finally', 'break', 'continue', 'debugger', 'with', 'do',
]);

const PY_KEYWORDS = new Set([
  'if', 'for', 'while', 'with', 'return', 'def', 'class', 'import', 'from',
  'raise', 'yield', 'lambda', 'await', 'async', 'del', 'pass', 'assert',
  'except', 'elif', 'else', 'not', 'and', 'or', 'in', 'is', 'print',
]);

const GO_KEYWORDS = new Set([
  'if', 'for', 'range', 'return', 'func', 'type', 'var', 'const', 'import', 'package',
  'go', 'defer', 'select', 'case', 'default', 'break', 'continue', 'goto', 'fallthrough',
  'chan', 'map', 'struct', 'interface', 'make', 'new', 'len', 'cap', 'append', 'delete',
  'panic', 'recover', 'close', 'switch', 'else',
]);

const JAVA_KEYWORDS = new Set([
  'if', 'for', 'while', 'do', 'switch', 'case', 'return', 'class', 'interface', 'enum',
  'new', 'extends', 'implements', 'import', 'package', 'throw', 'throws', 'catch', 'try',
  'finally', 'static', 'final', 'abstract', 'public', 'private', 'protected', 'void',
  'break', 'continue', 'default', 'else', 'instanceof', 'this', 'super',
]);

const RUST_KEYWORDS = new Set([
  'if', 'let', 'for', 'while', 'loop', 'match', 'return', 'fn', 'struct', 'enum', 'trait',
  'impl', 'use', 'mod', 'pub', 'super', 'self', 'type', 'where', 'in', 'as', 'mut',
  'ref', 'move', 'async', 'await', 'dyn', 'extern', 'crate', 'static', 'const', 'unsafe',
  'break', 'continue', 'else',
]);

// ── Supported extensions ──────────────────────────────────────────────────────

const TS_JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const PY_EXTS = new Set(['.py']);
const GO_EXTS = new Set(['.go']);
const JAVA_EXTS = new Set(['.java']);
const RUST_EXTS = new Set(['.rs']);

function isSupportedExt(ext: string): boolean {
  return TS_JS_EXTS.has(ext) || PY_EXTS.has(ext) || GO_EXTS.has(ext) || JAVA_EXTS.has(ext) || RUST_EXTS.has(ext);
}

// ── Language-specific extractors ──────────────────────────────────────────────

export function extractGoCallSites(source: string, filePath: string, fileNodeId: string): CallSite[] {
  const sites: CallSite[] = [];
  const methodPattern = /(\w+)\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodPattern.exec(source)) !== null) {
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
  }
  const directPattern = /(?<![.[\w])([A-Za-z_][\w]*)\s*\(/g;
  while ((m = directPattern.exec(source)) !== null) {
    const name = m[1]!;
    if (GO_KEYWORDS.has(name)) continue;
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
  }
  return sites;
}

export function extractJavaCallSites(source: string, filePath: string, fileNodeId: string): CallSite[] {
  const sites: CallSite[] = [];
  const methodPattern = /(\w+)\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodPattern.exec(source)) !== null) {
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
  }
  const directPattern = /(?<![.[\w])([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = directPattern.exec(source)) !== null) {
    const name = m[1]!;
    if (JAVA_KEYWORDS.has(name)) continue;
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
  }
  return sites;
}

export function extractRustCallSites(source: string, filePath: string, fileNodeId: string): CallSite[] {
  const sites: CallSite[] = [];
  const methodPattern = /(\w+)\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodPattern.exec(source)) !== null) {
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
  }
  const directPattern = /(?<![.[\w])([A-Za-z_][\w]*)\s*\(/g;
  while ((m = directPattern.exec(source)) !== null) {
    const name = m[1]!;
    if (RUST_KEYWORDS.has(name)) continue;
    sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
  }
  return sites;
}

// ── Stage 1 + 2: Extract and classify call sites ──────────────────────────────

function extractCallSites(
  source: string,
  filePath: string,
  fileNodeId: string,
  ext: string,
): CallSite[] {
  const sites: CallSite[] = [];

  if (TS_JS_EXTS.has(ext)) {
    // Method calls: word.word(
    const methodPattern = /(\w+)\.(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = methodPattern.exec(source)) !== null) {
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: `${m[1]}.${m[2]}`,
        form: 'method',
        receiverName: m[1],
        methodName: m[2],
      });
    }

    // Direct calls: word( not preceded by . or word char
    const directPattern = /(?<![.[\w])([A-Za-z_$][\w$]*)\s*\(/g;
    while ((m = directPattern.exec(source)) !== null) {
      const name = m[1];
      if (JS_KEYWORDS.has(name)) continue;
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: name,
        form: 'direct',
        methodName: name,
      });
    }

    // Dynamic calls: obj[key]( → mark as dynamic
    const dynamicPattern = /\w+\s*\[[\w'"` ]+\]\s*\(/g;
    while ((m = dynamicPattern.exec(source)) !== null) {
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: m[0],
        form: 'dynamic',
      });
    }
  } else if (PY_EXTS.has(ext)) {
    // Method calls: self.method( or obj.method(
    const methodPattern = /(\w+)\.(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = methodPattern.exec(source)) !== null) {
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: `${m[1]}.${m[2]}`,
        form: 'method',
        receiverName: m[1],
        methodName: m[2],
      });
    }

    // Direct calls: word( not preceded by . or word char
    const directPattern = /(?<![.[\w])([A-Za-z_][\w]*)\s*\(/g;
    while ((m = directPattern.exec(source)) !== null) {
      const name = m[1];
      if (PY_KEYWORDS.has(name)) continue;
      sites.push({
        callerFileNodeId: fileNodeId,
        callerFilePath: filePath,
        calleeRaw: name,
        form: 'direct',
        methodName: name,
      });
    }
  } else if (GO_EXTS.has(ext)) {
    return extractGoCallSites(source, filePath, fileNodeId);
  } else if (JAVA_EXTS.has(ext)) {
    return extractJavaCallSites(source, filePath, fileNodeId);
  } else if (RUST_EXTS.has(ext)) {
    return extractRustCallSites(source, filePath, fileNodeId);
  }

  return sites;
}

// ── Stage 3: Build import maps from DB (batch) ────────────────────────────────

/**
 * Load all IMPORTS edges once and return a map of fileNodeId → (name → filePath).
 * Eliminates the N+1 pattern of querying per-file inside the main loop.
 */
function buildAllImportMaps(
  ctx: PipelineContext,
  symbolNodes: MonographNode[],
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  if (!ctx.db) return result;

  // Build a lookup: fileNodeId → filePath from symbolNodes
  const idToFilePath = new Map<string, string>();
  for (const n of symbolNodes) {
    if (n.label === 'File' && n.filePath) {
      idToFilePath.set(n.id, n.filePath);
      // Also register the alternate makeId form
      const altId = makeId(n.filePath.replace(/\//g, '_'), 'file');
      if (altId !== n.id) idToFilePath.set(altId, n.filePath);
    }
  }

  // Load ALL IMPORTS edges in one query
  const importsRows = ctx.db
    .prepare(`SELECT source_id, target_id FROM edges WHERE relation = 'IMPORTS'`)
    .all() as { source_id: string; target_id: string }[];

  for (const row of importsRows) {
    const targetPath = idToFilePath.get(row.target_id);
    if (!targetPath) continue;
    let fileMap = result.get(row.source_id);
    if (!fileMap) {
      fileMap = new Map();
      result.set(row.source_id, fileMap);
    }
    const parts = targetPath.split('/');
    const baseName = parts[parts.length - 1].replace(/\.\w+$/, '');
    fileMap.set(baseName, targetPath);
    fileMap.set(targetPath, targetPath);
  }

  return result;
}

/** Returns the pre-built import map for a given file node (empty map if not found). */
function getImportMap(
  allImportMaps: Map<string, Map<string, string>>,
  fileNodeId: string,
): Map<string, string> {
  return allImportMaps.get(fileNodeId) ?? new Map();
}

// ── Stage 4 helpers: preloaded function/method index ──────────────────────────

/**
 * Load all Function/Method/Constructor nodes once.
 * Returns two indices:
 * - byFilePath: filePath → name → id[] (for resolveTarget candidate lookup)
 * - nameCounts: name → total occurrences across all files (for ambiguity check)
 */
function buildFunctionIndex(ctx: PipelineContext): {
  byFilePath: Map<string, Map<string, string[]>>;
  nameCounts: Map<string, number>;
} {
  const byFilePath = new Map<string, Map<string, string[]>>();
  const nameCounts = new Map<string, number>();

  if (!ctx.db) return { byFilePath, nameCounts };

  const rows = ctx.db
    .prepare(`SELECT id, name, file_path FROM nodes WHERE label IN ('Function', 'Method', 'Constructor') AND file_path IS NOT NULL`)
    .all() as { id: string; name: string; file_path: string }[];

  for (const row of rows) {
    // byFilePath index
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

    // global count for ambiguity detection
    nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
  }

  return { byFilePath, nameCounts };
}

// ── Stage 4 + 5: Resolve target node (index-based, no per-call DB query) ──────

function resolveTarget(
  site: CallSite,
  callerFilePath: string,
  importMap: Map<string, string>,
  fnIndex: Map<string, Map<string, string[]>>,
): { targetId: string } | null {
  const methodName = site.methodName;
  if (!methodName) return null;

  let candidateFilePaths: string[];

  if (site.form === 'method' && site.receiverName) {
    // Stage 3: Infer receiver type — look up receiver in import map
    const receiverPath = importMap.get(site.receiverName);
    candidateFilePaths = receiverPath ? [receiverPath] : [callerFilePath];
  } else if (site.form === 'direct') {
    // Direct call: same file first, then all imported files
    candidateFilePaths = [callerFilePath, ...importMap.values()];
  } else {
    return null;
  }

  // Stage 5: O(1) lookup in preloaded index instead of per-call DB query
  for (const fp of candidateFilePaths) {
    const ids = fnIndex.get(fp)?.get(methodName);
    if (ids && ids.length === 1) {
      return { targetId: ids[0] };
    }
    // ids.length > 1 → ambiguous within this file — skip to next candidate
  }

  return null;
}

// ── Stage 6: Emit edge ────────────────────────────────────────────────────────

function emitEdge(
  ctx: PipelineContext,
  sourceId: string,
  targetId: string,
): 'inserted' | 'upgraded' | 'skipped' {
  if (!ctx.db) return 'skipped';
  if (sourceId === targetId) return 'skipped';

  const RESOLVED_CONFIDENCE_SCORE = 0.75;

  // Check if a CALLS edge already exists
  const existing = ctx.db
    .prepare(`
      SELECT id, confidence_score FROM edges
      WHERE source_id = ? AND target_id = ? AND relation = 'CALLS'
    `)
    .get(sourceId, targetId) as { id: string; confidence_score: number } | undefined;

  if (existing) {
    const newScore = Math.max(existing.confidence_score, RESOLVED_CONFIDENCE_SCORE);
    if (newScore > existing.confidence_score) {
      ctx.db
        .prepare(`
          UPDATE edges
          SET confidence_score = ?, confidence = 'EXTRACTED'
          WHERE id = ?
        `)
        .run(newScore, existing.id);
    }
    return 'upgraded';
  }

  // Insert new CALLS edge
  const edgeId = makeId(sourceId, targetId, 'calls_resolved');
  try {
    ctx.db
      .prepare(`
        INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score)
        VALUES (?, ?, ?, 'CALLS', 'EXTRACTED', ?)
      `)
      .run(edgeId, sourceId, targetId, RESOLVED_CONFIDENCE_SCORE);
    return 'inserted';
  } catch {
    return 'skipped';
  }
}

// ── Phase definition ──────────────────────────────────────────────────────────

export const scopeResolutionPhase: PipelinePhase<ScopeResolutionOutput> = {
  name: 'scope-resolution',
  deps: ['parse', 'cross-file'],
  async execute(ctx, deps) {
    const { symbolNodes } = deps.get('parse') as ParseOutput;

    let resolvedEdges = 0;
    let skippedDynamic = 0;
    let ambiguous = 0;

    // ── Batch preload: one query per table instead of one per file/call-site ──

    // Build a map from file_path → file node id using the parse output
    const fileNodesByPath = new Map<string, MonographNode>();
    for (const node of symbolNodes) {
      if (node.label === 'File' && node.filePath) {
        fileNodesByPath.set(node.filePath, node);
      }
    }

    // Also look up File nodes from the DB (includes nodes created by structure phase)
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

    // Preload all IMPORTS edges → per-file import maps (one DB query total)
    const allImportMaps = buildAllImportMaps(ctx, symbolNodes);

    // Preload all Function/Method/Constructor nodes into indices (one DB query total)
    const { byFilePath: fnIndex, nameCounts } = buildFunctionIndex(ctx);

    for (const [filePath, fileNode] of fileNodesByPath) {
      const ext = extname(filePath).toLowerCase();
      if (!isSupportedExt(ext)) continue;

      // Read file source
      let source: string;
      try {
        source = readFileSync(join(ctx.repoPath, filePath), 'utf-8');
      } catch {
        continue;
      }

      // Stage 1+2: Extract call sites
      const callSites = extractCallSites(source, filePath, fileNode.id, ext);

      // Stage 3: Get pre-built import map for this file (O(1))
      const importMap = getImportMap(allImportMaps, fileNode.id);

      for (const site of callSites) {
        if (site.form === 'dynamic') {
          skippedDynamic++;
          continue;
        }

        // Stage 4+5: Resolve target using preloaded indices (no DB query)
        const resolved = resolveTarget(site, filePath, importMap, fnIndex);

        if (!resolved) {
          // Could not resolve — method calls with unresolvable receivers are simply skipped
          continue;
        }

        // Ambiguity check using preloaded name counts (no DB query)
        if (site.methodName && (nameCounts.get(site.methodName) ?? 0) > 1) {
          ambiguous++;
          // Still emit — we found exactly one candidate in the caller's context
        }

        // Stage 6: Emit edge (source is the file node of the caller)
        const result = emitEdge(ctx, site.callerFileNodeId, resolved.targetId);
        if (result === 'inserted' || result === 'upgraded') {
          resolvedEdges++;
        }
      }
    }

    return { resolvedEdges, skippedDynamic, ambiguous };
  },
};
