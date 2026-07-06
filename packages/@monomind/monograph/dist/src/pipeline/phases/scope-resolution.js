import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname, resolve as resolvePath } from 'path';
import { makeId } from '../../types.js';
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
function isSupportedExt(ext) {
    return TS_JS_EXTS.has(ext) || PY_EXTS.has(ext) || GO_EXTS.has(ext) || JAVA_EXTS.has(ext) || RUST_EXTS.has(ext);
}
// ── Language-specific extractors ──────────────────────────────────────────────
export function extractGoCallSites(source, filePath, fileNodeId) {
    const sites = [];
    const methodPattern = /(\w+)\.(\w+)\s*\(/g;
    let m;
    while ((m = methodPattern.exec(source)) !== null) {
        sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
    }
    const directPattern = /(?<![.[\w])([A-Za-z_][\w]*)\s*\(/g;
    while ((m = directPattern.exec(source)) !== null) {
        const name = m[1];
        if (GO_KEYWORDS.has(name))
            continue;
        sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
    }
    return sites;
}
export function extractJavaCallSites(source, filePath, fileNodeId) {
    const sites = [];
    const methodPattern = /(\w+)\.(\w+)\s*\(/g;
    let m;
    while ((m = methodPattern.exec(source)) !== null) {
        sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
    }
    const directPattern = /(?<![.[\w])([A-Za-z_$][\w$]*)\s*\(/g;
    while ((m = directPattern.exec(source)) !== null) {
        const name = m[1];
        if (JAVA_KEYWORDS.has(name))
            continue;
        sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
    }
    return sites;
}
export function extractRustCallSites(source, filePath, fileNodeId) {
    const sites = [];
    const methodPattern = /(\w+)\.(\w+)\s*\(/g;
    let m;
    while ((m = methodPattern.exec(source)) !== null) {
        sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: `${m[1]}.${m[2]}`, form: 'method', receiverName: m[1], methodName: m[2] });
    }
    const directPattern = /(?<![.[\w])([A-Za-z_][\w]*)\s*\(/g;
    while ((m = directPattern.exec(source)) !== null) {
        const name = m[1];
        if (RUST_KEYWORDS.has(name))
            continue;
        sites.push({ callerFileNodeId: fileNodeId, callerFilePath: filePath, calleeRaw: name, form: 'direct' });
    }
    return sites;
}
// ── Stage 1 + 2: Extract and classify call sites ──────────────────────────────
function extractCallSites(source, filePath, fileNodeId, ext) {
    const sites = [];
    if (TS_JS_EXTS.has(ext)) {
        // Method calls: word.word( or word.word<T>(
        const methodPattern = /(\w+)\.(\w+)\s*(?:<[^>]*>\s*)?\(/g;
        let m;
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
        // Direct calls: word( or word<T>( — not preceded by . or word char
        const directPattern = /(?<![.[\w])([A-Za-z_$][\w$]*)\s*(?:<[^>]*>\s*)?\(/g;
        while ((m = directPattern.exec(source)) !== null) {
            const name = m[1];
            if (JS_KEYWORDS.has(name))
                continue;
            sites.push({
                callerFileNodeId: fileNodeId,
                callerFilePath: filePath,
                calleeRaw: name,
                form: 'direct',
                methodName: name,
            });
        }
        // Constructor calls: new ClassName( or new ClassName<T>(
        const newPattern = /\bnew\s+([A-Z][\w$]*)\s*(?:<[^>]*>\s*)?\(/g;
        while ((m = newPattern.exec(source)) !== null) {
            sites.push({
                callerFileNodeId: fileNodeId,
                callerFilePath: filePath,
                calleeRaw: `new ${m[1]}`,
                form: 'direct',
                methodName: m[1],
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
    }
    else if (PY_EXTS.has(ext)) {
        // Method calls: self.method( or obj.method(
        const methodPattern = /(\w+)\.(\w+)\s*\(/g;
        let m;
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
            if (PY_KEYWORDS.has(name))
                continue;
            sites.push({
                callerFileNodeId: fileNodeId,
                callerFilePath: filePath,
                calleeRaw: name,
                form: 'direct',
                methodName: name,
            });
        }
    }
    else if (GO_EXTS.has(ext)) {
        return extractGoCallSites(source, filePath, fileNodeId);
    }
    else if (JAVA_EXTS.has(ext)) {
        return extractJavaCallSites(source, filePath, fileNodeId);
    }
    else if (RUST_EXTS.has(ext)) {
        return extractRustCallSites(source, filePath, fileNodeId);
    }
    return sites;
}
// ── Stage 3: Build import maps by parsing source imports ─────────────────────
const IMPORT_RE = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+)))?\s+from\s+['"]([^'"]+)['"]/g;
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx'];
/**
 * Build package-name → directory map from workspace package.json files.
 * Scans packages/ for package.json and maps npm name to its relative src path.
 */
function buildWorkspacePackageMap(repoPath) {
    const result = new Map();
    const packagesDir = join(repoPath, 'packages');
    try {
        const scanDirs = (base, depth) => {
            if (depth > 2)
                return;
            let entries;
            try {
                entries = require('fs').readdirSync(base);
            }
            catch {
                return;
            }
            for (const e of entries) {
                const full = join(base, e);
                const pkgJson = join(full, 'package.json');
                try {
                    const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
                    if (pkg.name) {
                        const relDir = full.slice(repoPath.length + 1); // e.g. packages/@monomind/cli
                        result.set(pkg.name, relDir);
                    }
                }
                catch {
                    // No package.json — recurse for @scoped dirs
                    if (e.startsWith('@'))
                        scanDirs(full, depth + 1);
                }
            }
        };
        scanDirs(packagesDir, 0);
    }
    catch { /* no packages dir */ }
    return result;
}
function resolveModuleSpecifier(importerPath, specifier, repoPath, knownFiles, workspaceMap) {
    if (specifier.startsWith('.')) {
        const dir = dirname(importerPath);
        const raw = resolvePath('/', dir, specifier).slice(1);
        // Strip .js/.jsx — TS source uses .js extensions but files are .ts
        const base = raw.replace(/\.(js|jsx)$/, '');
        for (const candidate of [
            raw,
            base,
            ...RESOLVE_EXTS.map(e => base + e),
            ...RESOLVE_EXTS.map(e => base + '/index' + e),
        ]) {
            if (knownFiles.has(candidate))
                return candidate;
        }
        for (const ext of RESOLVE_EXTS) {
            if (existsSync(join(repoPath, base + ext)))
                return base + ext;
        }
        return null;
    }
    // Workspace package specifier: @monomind/hooks → packages/@monomind/hooks/src/index.ts
    // Also handles subpath: @monomind/hooks/src/foo → packages/@monomind/hooks/src/foo.ts
    for (const [pkgName, pkgDir] of workspaceMap) {
        if (specifier === pkgName) {
            // Bare import: resolve to package entry point (src/index.ts)
            for (const entry of RESOLVE_EXTS.map(e => pkgDir + '/src/index' + e)) {
                if (knownFiles.has(entry))
                    return entry;
            }
            return null;
        }
        if (specifier.startsWith(pkgName + '/')) {
            const subpath = specifier.slice(pkgName.length + 1);
            const base = pkgDir + '/' + subpath;
            for (const candidate of [
                base,
                ...RESOLVE_EXTS.map(e => base + e),
                ...RESOLVE_EXTS.map(e => base + '/index' + e),
            ]) {
                if (knownFiles.has(candidate))
                    return candidate;
            }
            return null;
        }
    }
    return null;
}
function extractImportNames(clause) {
    return clause
        .split(',')
        .map(s => s.trim().split(/\s+as\s+/).pop().trim())
        .filter(Boolean);
}
/**
 * Parse each file's import statements to build importedName → resolvedFilePath maps.
 * Replaces the broken DB-edge approach (IMPORTS edges target Variable nodes, not Files).
 */
function buildAllImportMapsFromSource(repoPath, fileNodesByPath) {
    const result = new Map();
    const knownFiles = new Set(fileNodesByPath.keys());
    const workspaceMap = buildWorkspacePackageMap(repoPath);
    for (const [filePath, fileNode] of fileNodesByPath) {
        const ext = extname(filePath).toLowerCase();
        if (!TS_JS_EXTS.has(ext))
            continue;
        let source;
        try {
            source = readFileSync(join(repoPath, filePath), 'utf-8');
        }
        catch {
            continue;
        }
        const importMap = new Map();
        IMPORT_RE.lastIndex = 0;
        let m;
        while ((m = IMPORT_RE.exec(source)) !== null) {
            const specifier = m[7];
            const resolved = resolveModuleSpecifier(filePath, specifier, repoPath, knownFiles, workspaceMap);
            if (!resolved)
                continue;
            // Named imports: { foo, bar as baz }
            if (m[1])
                for (const n of extractImportNames(m[1]))
                    importMap.set(n, resolved);
            if (m[4])
                for (const n of extractImportNames(m[4]))
                    importMap.set(n, resolved);
            // Default import
            if (m[2])
                importMap.set(m[2], resolved);
            if (m[5])
                importMap.set(m[5], resolved);
            // Namespace import: * as X
            if (m[3])
                importMap.set(m[3], resolved);
            if (m[6])
                importMap.set(m[6], resolved);
            // Store the module path itself (for method call receiver lookup by module name)
            const baseName = resolved.split('/').pop().replace(/\.\w+$/, '');
            importMap.set(baseName, resolved);
        }
        if (importMap.size > 0) {
            result.set(fileNode.id, importMap);
        }
    }
    return result;
}
function getImportMap(allImportMaps, fileNodeId) {
    return allImportMaps.get(fileNodeId) ?? new Map();
}
// ── Stage 4 helpers: preloaded function/method index ──────────────────────────
/**
 * Load all callable nodes once (Function, Method, Constructor, Class).
 * Class is included so `new ClassName()` can resolve to Class nodes.
 */
function buildFunctionIndex(ctx) {
    const byFilePath = new Map();
    const nameCounts = new Map();
    if (!ctx.db)
        return { byFilePath, nameCounts };
    const rows = ctx.db
        .prepare(`SELECT id, name, file_path FROM nodes WHERE label IN ('Function', 'Method', 'Constructor', 'Class') AND file_path IS NOT NULL`)
        .all();
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
function pickBestId(ids, site) {
    if (ids.length === 1)
        return ids[0];
    if (ids.length === 0)
        return null;
    // Disambiguate: prefer Function for direct calls, Method for method calls
    const suffix = site.form === 'method' ? '_method' : '_function';
    const match = ids.find(id => id.endsWith(suffix));
    // For `new ClassName()` prefer _class
    if (!match && site.calleeRaw.startsWith('new ')) {
        const classMatch = ids.find(id => id.endsWith('_class'));
        if (classMatch)
            return classMatch;
    }
    return match ?? ids[0];
}
function resolveTarget(site, callerFilePath, importMap, fnIndex) {
    const methodName = site.methodName;
    if (!methodName)
        return null;
    let candidateFilePaths;
    if (site.form === 'method' && site.receiverName) {
        const receiverPath = importMap.get(site.receiverName);
        if (receiverPath) {
            candidateFilePaths = [receiverPath];
        }
        else {
            // Receiver not in import map (local variable). Try same-file first.
            const sameFileIds = fnIndex.get(callerFilePath)?.get(methodName);
            if (sameFileIds && sameFileIds.length > 0) {
                return { targetId: pickBestId(sameFileIds, site) };
            }
            // Fallback: find exactly one imported file with this method
            const importedFiles = [...new Set(importMap.values())];
            const matches = importedFiles.filter(fp => fnIndex.get(fp)?.has(methodName));
            if (matches.length === 1) {
                const ids = fnIndex.get(matches[0]).get(methodName);
                return { targetId: pickBestId(ids, site) };
            }
            return null;
        }
    }
    else if (site.form === 'direct') {
        const importedFrom = importMap.get(methodName);
        if (importedFrom) {
            candidateFilePaths = [importedFrom, callerFilePath];
        }
        else {
            candidateFilePaths = [callerFilePath, ...new Set(importMap.values())];
        }
    }
    else {
        return null;
    }
    for (const fp of candidateFilePaths) {
        const ids = fnIndex.get(fp)?.get(methodName);
        if (ids && ids.length > 0) {
            const best = pickBestId(ids, site);
            if (best)
                return { targetId: best };
        }
    }
    return null;
}
// ── Stage 6: Emit edge ────────────────────────────────────────────────────────
function emitEdge(ctx, sourceId, targetId) {
    if (!ctx.db)
        return 'skipped';
    if (sourceId === targetId)
        return 'skipped';
    const RESOLVED_CONFIDENCE_SCORE = 0.75;
    // Check if a CALLS edge already exists
    const existing = ctx.db
        .prepare(`
      SELECT id, confidence_score FROM edges
      WHERE source_id = ? AND target_id = ? AND relation = 'CALLS'
    `)
        .get(sourceId, targetId);
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
    }
    catch {
        return 'skipped';
    }
}
// ── Phase definition ──────────────────────────────────────────────────────────
export const scopeResolutionPhase = {
    name: 'scope-resolution',
    deps: ['parse', 'cross-file'],
    async execute(ctx, deps) {
        const { symbolNodes } = deps.get('parse');
        let resolvedEdges = 0;
        let skippedDynamic = 0;
        let ambiguous = 0;
        // ── Batch preload: one query per table instead of one per file/call-site ──
        // Build a map from file_path → file node id using the parse output
        const fileNodesByPath = new Map();
        for (const node of symbolNodes) {
            if (node.label === 'File' && node.filePath) {
                fileNodesByPath.set(node.filePath, node);
            }
        }
        // Also look up File nodes from the DB (includes nodes created by structure phase)
        if (ctx.db) {
            const dbFileNodes = ctx.db
                .prepare(`SELECT id, file_path FROM nodes WHERE label = 'File'`)
                .all();
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
        // Parse source imports → per-file import maps (replaces broken DB-edge approach)
        const allImportMaps = buildAllImportMapsFromSource(ctx.repoPath, fileNodesByPath);
        // Preload all Function/Method/Constructor nodes into indices (one DB query total)
        const { byFilePath: fnIndex, nameCounts } = buildFunctionIndex(ctx);
        for (const [filePath, fileNode] of fileNodesByPath) {
            const ext = extname(filePath).toLowerCase();
            if (!isSupportedExt(ext))
                continue;
            // Read file source
            let source;
            try {
                source = readFileSync(join(ctx.repoPath, filePath), 'utf-8');
            }
            catch {
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
        // Clean up orphan IMPORTS edges that target Variable nodes instead of Files.
        // These were created by the parser's raw import extraction and never resolved
        // to meaningful targets (e.g. `import fs` → a Variable named `fs`).
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
        return { resolvedEdges, skippedDynamic, ambiguous, orphanImportsRemoved };
    },
};
//# sourceMappingURL=scope-resolution.js.map