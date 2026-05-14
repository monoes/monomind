// post-build knowledge graph enrichment engine
// Reads graph.json, enriches nodes with TypeScript AST data, resolves
// cross-module calls, computes PageRank + eigenvector centrality,
// then writes graph.enriched.json.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// packages/@monomind/cli/dist/src/graph/ → 6 levels up → project root
const projectRoot = path.resolve(__dirname, '../../../../../..');
const _require = createRequire(path.join(projectRoot, 'package.json'));

// ── dependencies ──────────────────────────────────────────────────────────

let ts;
try { ts = _require('typescript'); }
catch { ts = _require(path.join(projectRoot, 'node_modules/typescript/lib/typescript.js')); }

function findPnpmPkg(name) {
  const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  const prefix = name.replace('/', '+') + '@';
  const entries = fs.readdirSync(pnpmDir).filter(e => e.startsWith(prefix)).sort().reverse();
  return entries.length ? path.join(pnpmDir, entries[0], 'node_modules', name) : null;
}

function loadGraphology() {
  for (const fn of [() => _require('graphology'), () => _require(findPnpmPkg('graphology'))]) {
    try { const m = fn(); return m.default ?? m; } catch {}
  }
  throw new Error('graphology not found');
}

function loadGraphologyMetrics() {
  const base = findPnpmPkg('graphology-metrics') ?? path.join(projectRoot, 'node_modules/graphology-metrics');
  return {
    assignPageRank: _require(path.join(base, 'centrality/pagerank')).assign,
    assignEigen: _require(path.join(base, 'centrality/eigenvector')).assign,
  };
}

// ── cache ─────────────────────────────────────────────────────────────────

const sha256 = str => crypto.createHash('sha256').update(str).digest('hex');
const cacheFileFor = (fp, dir) => path.join(dir, sha256(fp) + '.json');

function readFromCache(filePath, cacheDir) {
  try {
    const cf = cacheFileFor(filePath, cacheDir);
    if (fs.statSync(cf).mtimeMs >= fs.statSync(filePath).mtimeMs)
      return JSON.parse(fs.readFileSync(cf, 'utf8'));
  } catch {}
  return null;
}

function writeToCache(filePath, data, cacheDir) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFileFor(filePath, cacheDir), JSON.stringify(data));
  } catch {}
}

// ── TypeScript AST extraction ─────────────────────────────────────────────

function getJsDoc(node, sf) {
  try {
    return (ts.getJSDocCommentsAndTags(node) ?? [])
      .filter(t => ts.isJSDoc(t))
      .map(t => typeof t.comment === 'string' ? t.comment : '')
      .join('\n').trim();
  } catch { return ''; }
}

const getParams = (node, sf) => (node.parameters ?? []).map(p => ({
  name: p.name?.getText(sf) ?? '', type: p.type?.getText(sf) ?? 'any', optional: !!p.questionToken,
}));

const buildSig = (params, ret) => {
  const ps = params.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');
  return `(${ps})${ret ? ': ' + ret : ''}`;
};

const isExported = node => !!(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export);
const lineOf = (node, sf) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;

function extractSymbolsFromAst(filePath, content) {
  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const symbols = new Map();

  function visit(node) {
    try {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const params = getParams(node, sf); const ret = node.type?.getText(sf) ?? '';
        symbols.set(node.name.getText(sf), { kind: 'function', signature: buildSig(params, ret),
          parameters: params, returnType: ret, isExported: isExported(node),
          documentation: getJsDoc(node, sf), lineStart: lineOf(node, sf) });
      } else if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.getText(sf);
        const heritage = (node.heritageClauses ?? []).flatMap(c => c.types.map(t => t.expression.getText(sf)));
        const methods = (node.members ?? []).filter(m => ts.isMethodDeclaration(m) && m.name).map(m => {
          const mp = getParams(m, sf); const mr = m.type?.getText(sf) ?? '';
          return { name: m.name.getText(sf), signature: buildSig(mp, mr), documentation: getJsDoc(m, sf) };
        });
        symbols.set(name, { kind: 'class', signature: name + (heritage.length ? ' extends ' + heritage[0] : ''),
          parameters: [], returnType: '', isExported: isExported(node),
          documentation: getJsDoc(node, sf), lineStart: lineOf(node, sf), heritage, methods });
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        const name = node.name.getText(sf);
        symbols.set(name, { kind: 'interface', signature: name, parameters: [], returnType: '',
          isExported: isExported(node), documentation: getJsDoc(node, sf), lineStart: lineOf(node, sf) });
      } else if (ts.isTypeAliasDeclaration(node) && node.name) {
        const name = node.name.getText(sf);
        symbols.set(name, { kind: 'type', signature: name, parameters: [], returnType: '',
          isExported: isExported(node), documentation: getJsDoc(node, sf), lineStart: lineOf(node, sf) });
      } else if (ts.isVariableStatement(node)) {
        const exp = isExported(node);
        for (const decl of node.declarationList.declarations) {
          if (decl.name && decl.initializer &&
              (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            const params = getParams(decl.initializer, sf); const ret = decl.initializer.type?.getText(sf) ?? '';
            symbols.set(decl.name.getText(sf), { kind: 'variable', signature: buildSig(params, ret),
              parameters: params, returnType: ret, isExported: exp,
              documentation: getJsDoc(node, sf), lineStart: lineOf(node, sf) });
          }
        }
      }
    } catch {}
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return symbols;
}

function extractImportMap(filePath, content) {
  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const importMap = new Map();
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      try {
        const spec = node.moduleSpecifier.getText(sf).replace(/^['"]|['"]$/g, '');
        if (!spec.startsWith('.')) return; // skip node_modules
        const resolved = resolveRelativeImport(spec, filePath);
        if (!resolved) return;
        const clause = node.importClause;
        if (!clause) return;
        if (clause.name) importMap.set(clause.name.getText(sf), resolved);
        const b = clause.namedBindings;
        if (b) {
          if (ts.isNamespaceImport(b)) importMap.set(b.name.getText(sf), resolved);
          else if (ts.isNamedImports(b)) for (const el of b.elements) importMap.set(el.name.getText(sf), resolved);
        }
      } catch {}
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return importMap;
}

function resolveRelativeImport(spec, fromFile) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const exts = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of exts) if (fs.existsSync(base + ext)) return base + ext;
  for (const ext of exts) { const c = path.join(base, 'index' + ext); if (fs.existsSync(c)) return c; }
  return null;
}

// ── regex fallback ────────────────────────────────────────────────────────

function extractSymbolsRegex(content) {
  const symbols = new Map(); let m;
  const fn = /export\s+(async\s+)?function\s+(\w+)\(([^)]*)\)/g;
  while ((m = fn.exec(content)) !== null) {
    const params = m[3].trim() ? m[3].trim().split(',').map(p => ({ name: p.trim(), type: 'any', optional: false })) : [];
    symbols.set(m[2], { kind: 'function', signature: buildSig(params, ''), parameters: params,
      returnType: '', isExported: true, documentation: '', lineStart: 0 });
  }
  const cl = /export\s+class\s+(\w+)/g;
  while ((m = cl.exec(content)) !== null)
    symbols.set(m[1], { kind: 'class', signature: m[1], parameters: [], returnType: '',
      isExported: true, documentation: '', lineStart: 0 });
  return symbols;
}

// ── per-file extraction ───────────────────────────────────────────────────

const MAX_TS_SIZE = 500 * 1024;

function extractFile(filePath, cacheDir) {
  const cached = readFromCache(filePath, cacheDir);
  if (cached) return { symbols: new Map(Object.entries(cached.symbols)), importMap: new Map(Object.entries(cached.importMap)) };

  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return { symbols: new Map(), importMap: new Map() }; }

  const isTs = /\.[cm]?ts$|\.tsx$/.test(filePath);
  let symbols, importMap = new Map();
  if (isTs && content.length <= MAX_TS_SIZE) {
    try { symbols = extractSymbolsFromAst(filePath, content); importMap = extractImportMap(filePath, content); }
    catch { symbols = extractSymbolsRegex(content); }
  } else {
    symbols = extractSymbolsRegex(content);
  }
  writeToCache(filePath, { symbols: Object.fromEntries(symbols), importMap: Object.fromEntries(importMap) }, cacheDir);
  return { symbols, importMap };
}

// ── main ──────────────────────────────────────────────────────────────────

export async function enrichGraph(projectDir, options = {}) {
  const graphDir = options.graphDir ?? path.join(projectDir, '.monomind', 'graph');
  const verbose = options.verbose ?? false;
  const forceRebuild = options.forceRebuild ?? false;
  const cacheDir = path.join(graphDir, 'cache', 'symbols');

  const graphPath = path.join(graphDir, 'graph.json');
  if (!fs.existsSync(graphPath)) throw new Error(`graph.json not found at ${graphPath}`);
  const rawGraph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const nodes = rawGraph.nodes ?? [];
  const links = rawGraph.links ?? rawGraph.edges ?? [];

  // Phase 1+2: extract symbols + import maps per unique source file
  const uniqueFiles = [...new Set(nodes.map(n => n.sourceFile).filter(Boolean))];
  const symbolCache = new Map(), importCache = new Map();
  let filesProcessed = 0;
  for (const fp of uniqueFiles) {
    if (forceRebuild) { try { fs.unlinkSync(cacheFileFor(fp, cacheDir)); } catch {} }
    const { symbols, importMap } = extractFile(fp, cacheDir);
    symbolCache.set(fp, symbols); importCache.set(fp, importMap);
    filesProcessed++;
    if (filesProcessed % 100 === 0 || verbose) {
      console.log(`[enrich] processed ${filesProcessed}/${uniqueFiles.length} files (${Math.round(filesProcessed / uniqueFiles.length * 100)}%)`);
    }
  }

  // Phase 3: enrich nodes
  let enrichedCount = 0;
  const enrichedNodes = nodes.map(node => {
    const n = { ...node, inDegree: 0, outDegree: 0 };
    const info = symbolCache.get(n.sourceFile)?.get(n.label) ?? symbolCache.get(n.sourceFile)?.get(n.id);
    if (info) {
      Object.assign(n, { kind: info.kind, signature: info.signature, parameters: info.parameters,
        returnType: info.returnType, isExported: info.isExported, documentation: info.documentation });
      enrichedCount++;
    }
    return n;
  });

  // Phase 4: resolve call/import edges to cross-module links
  const nodeById = new Map(enrichedNodes.map(n => [n.id, n]));
  const nodesByFile = new Map();
  for (const n of enrichedNodes) {
    if (!n.sourceFile) continue;
    if (!nodesByFile.has(n.sourceFile)) nodesByFile.set(n.sourceFile, []);
    nodesByFile.get(n.sourceFile).push(n);
  }

  // Walk importCache directly: sourceFile → (importedSymbol → resolvedAbsolutePath).
  // This avoids the graph.json edge format mismatch where link.source is a short filename/path
  // rather than a symbol-name node ID, which caused resolvedCallEdges: 0 when iterating links.
  //
  // One edge per (sourceFile → target node) — not one per source symbol. Fanning out to all
  // N nodes in a file per import inflates edge counts by O(N) and corrupts PageRank.
  // We use the first node in the file as a stable representative for the file-level dependency.
  const resolvedLinks = []; const seenEdgeKeys = new Set();
  for (const [sourceFile, symbolMap] of importCache) {
    const fileNodes = nodesByFile.get(sourceFile) ?? [];
    if (!fileNodes.length) continue;
    const repNode = fileNodes[0]; // representative node for this source file
    for (const [symbolName, resolvedPath] of symbolMap) {
      const candidates = nodesByFile.get(resolvedPath) ?? [];
      // Prefer a node in the target file whose label/id matches the imported symbol name
      const tgt = candidates.find(n => n.label === symbolName || n.id === symbolName) ?? candidates[0];
      if (!tgt) continue;
      if (repNode.id === tgt.id) continue; // skip self-edges
      // Deduplicate by (sourceFile, tgt.id) — one edge per file-level import relationship
      const key = `${sourceFile}:${tgt.id}`;
      if (seenEdgeKeys.has(key)) continue;
      seenEdgeKeys.add(key);
      resolvedLinks.push({ source: repNode.id, target: tgt.id, relation: 'calls_module',
        confidence: 'INFERRED', weight: 1, resolvedFrom: symbolName });
    }
  }

  // Phase 5: degree counts.
  // Raw graph.json links use filename paths as link.source, not symbol IDs, so nodeById
  // lookups on raw links return undefined. Only resolvedLinks have symbol-name IDs on both
  // ends and reliably hit nodeById.
  const allEdges = [...links, ...resolvedLinks];
  for (const link of resolvedLinks) {
    const s = nodeById.get(link.source); const t = nodeById.get(link.target);
    if (s) s.outDegree++; if (t) t.inDegree++;
  }

  // Phase 6: PageRank + eigenvector centrality
  const Graph = loadGraphology();
  const { assignPageRank, assignEigen } = loadGraphologyMetrics();
  const G = new Graph({ type: 'directed', multi: false });
  for (const n of enrichedNodes) G.addNode(n.id, { ...n });
  // Guard both endpoints: raw links have filename paths as source which are not graph nodes.
  for (const link of allEdges) {
    try {
      if (G.hasNode(link.source) && G.hasNode(link.target))
        G.addEdge(link.source, link.target, { weight: link.weight ?? 1 });
    } catch {}
  }

  let pageRankComputed = false, centralityComputed = false;
  try { assignPageRank(G, { alpha: 0.85, maxIterations: 100, tolerance: 1e-6 }); pageRankComputed = true; }
  catch (e) { console.warn('[enrich] PageRank failed:', e.message); }
  try { assignEigen(G, { maxIterations: 500, tolerance: 1e-4, normalize: true }); centralityComputed = true; }
  catch (e) { console.warn('[enrich] Eigenvector centrality skipped (disconnected graph):', e.message); }

  // Map graphology attr names (pagerank, eigenvectorCentrality) to output (pageRank, centrality)
  G.forEachNode((id, attrs) => {
    const n = nodeById.get(id); if (!n) return;
    n.pageRank = attrs.pagerank ?? 0; n.centrality = attrs.eigenvectorCentrality ?? 0;
  });

  // Phase 7: write graph.enriched.json
  const metrics = { totalNodes: enrichedNodes.length, enrichedNodes: enrichedCount,
    totalEdges: allEdges.length, analyzedEdges: G.size,
    resolvedCallEdges: resolvedLinks.length, pageRankComputed, centralityComputed };
  const output = { version: '1.0.0', builtAt: rawGraph.builtAt ?? 0, projectPath: projectDir,
    enrichedAt: Date.now(), nodes: enrichedNodes, links: allEdges, metrics };
  const outputPath = path.join(graphDir, 'graph.enriched.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`[enrich] wrote ${outputPath}`);

  // Update stats.json
  const statsPath = path.join(graphDir, 'stats.json');
  try {
    const stats = fs.existsSync(statsPath) ? JSON.parse(fs.readFileSync(statsPath, 'utf8')) : {};
    stats.enrichedAt = Date.now(); stats.enrichedNodes = enrichedCount;
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  } catch {}

  return { enrichedNodes, resolvedEdges: resolvedLinks, metrics };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const projectDir = process.argv[2];
  if (!projectDir) {
    console.error('Usage: node enrich.mjs <project-dir> [--graph-dir <dir>] [--verbose] [--force]');
    process.exit(1);
  }
  const args = process.argv.slice(3);
  const opts = { verbose: args.includes('--verbose'), forceRebuild: args.includes('--force') };
  const gdIdx = args.indexOf('--graph-dir');
  if (gdIdx !== -1 && args[gdIdx + 1]) opts.graphDir = args[gdIdx + 1];
  enrichGraph(path.resolve(projectDir), opts)
    .then(({ metrics }) => console.log('[enrich] done:', JSON.stringify(metrics, null, 2)))
    .catch(err => { console.error('[enrich] fatal:', err.message); process.exit(1); });
}
