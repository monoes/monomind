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

// ── Stage 3: Build import map from DB ─────────────────────────────────────────

/** Returns a map of imported name → source file path for a given file node */
function buildImportMap(
  ctx: PipelineContext,
  fileNodeId: string,
  symbolNodes: MonographNode[],
): Map<string, string> {
  const importMap = new Map<string, string>();

  if (!ctx.db) return importMap;

  // Get IMPORTS edges for this file to find which modules it imports
  const importsRows = ctx.db
    .prepare(`SELECT target_id FROM edges WHERE source_id = ? AND relation = 'IMPORTS'`)
    .all(fileNodeId) as { target_id: string }[];

  for (const row of importsRows) {
    const targetId = row.target_id;
    // Find a File node that matches the resolved target
    const fileNode = symbolNodes.find(
      n => n.label === 'File' && (
        n.id === targetId ||
        makeId(n.filePath?.replace(/\//g, '_') ?? '', 'file') === targetId
      ),
    );
    if (fileNode?.filePath) {
      // Extract the module name from the last path segment without extension
      const parts = fileNode.filePath.split('/');
      const baseName = parts[parts.length - 1].replace(/\.\w+$/, '');
      importMap.set(baseName, fileNode.filePath);
      importMap.set(fileNode.filePath, fileNode.filePath);
    }
  }

  return importMap;
}

// ── Stage 4 + 5: Resolve target node ─────────────────────────────────────────

function resolveTarget(
  ctx: PipelineContext,
  site: CallSite,
  callerFilePath: string,
  importMap: Map<string, string>,
): { targetId: string } | null {
  if (!ctx.db) return null;

  const methodName = site.methodName;
  if (!methodName) return null;

  let candidateFilePaths: string[] = [];

  if (site.form === 'method' && site.receiverName) {
    // Stage 3: Infer receiver type — look up receiver in import map
    const receiverPath = importMap.get(site.receiverName);
    if (receiverPath) {
      candidateFilePaths = [receiverPath];
    } else {
      // Receiver not imported — look in same file only
      candidateFilePaths = [callerFilePath];
    }
  } else if (site.form === 'direct') {
    // Direct call: same file first, then all imported files
    candidateFilePaths = [callerFilePath, ...importMap.values()];
  } else {
    return null;
  }

  // Stage 5: Query nodes table for matching function/method/constructor
  for (const fp of candidateFilePaths) {
    const rows = ctx.db
      .prepare(`
        SELECT id FROM nodes
        WHERE name = ?
          AND label IN ('Function', 'Method', 'Constructor')
          AND file_path = ?
        LIMIT 2
      `)
      .all(methodName, fp) as { id: string }[];

    if (rows.length === 1) {
      return { targetId: rows[0].id };
    }
    // If > 1 match, it's ambiguous — skip this candidate file
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

      // Stage 3: Build import map for this file
      const importMap = buildImportMap(ctx, fileNode.id, symbolNodes);

      for (const site of callSites) {
        if (site.form === 'dynamic') {
          skippedDynamic++;
          continue;
        }

        // Stage 4+5: Resolve target
        const resolved = resolveTarget(ctx, site, filePath, importMap);

        if (!resolved) {
          // Could not resolve — treat as ambiguous if we had candidates
          // (method calls with unresolvable receivers are simply skipped)
          continue;
        }

        // Check if the resolved target is actually in multiple places (ambiguity check)
        if (ctx.db && site.methodName) {
          const totalMatches = ctx.db
            .prepare(`
              SELECT COUNT(*) as cnt FROM nodes
              WHERE name = ?
                AND label IN ('Function', 'Method', 'Constructor')
            `)
            .get(site.methodName) as { cnt: number };
          if (totalMatches.cnt > 1) {
            ambiguous++;
            // Still emit if we found exactly one in the candidate file — this is per-file ambiguity
            // The resolve already picked one candidate, so proceed
          }
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
