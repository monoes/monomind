'use strict';
// Runs at SessionStart — rebuilds the knowledge graph for the current project in the background.
// Fire-and-forget: spawns detached child, logs start, exits immediately without blocking session.
const path = require('path');
const fs = require('fs');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const graphDir = path.join(projectDir, '.monomind', 'graph');
const statsFile = path.join(graphDir, 'stats.json');

// Locate @monomind/graph — check pnpm store first, then regular node_modules
function findGraphPkg(base) {
  const candidates = [
    path.join(base, 'node_modules', '@monomind', 'graph', 'dist', 'src', 'index.js'),
    path.join(base, 'packages', '@monomind', 'cli', 'node_modules', '@monomind', 'graph', 'dist', 'src', 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // pnpm: glob for @monomind+graph in .pnpm
  const pnpmDir = path.join(base, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith('@monomind+graph')) {
        const p = path.join(pnpmDir, entry, 'node_modules', '@monomind', 'graph', 'dist', 'src', 'index.js');
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

const graphPkg = findGraphPkg(projectDir);

if (!graphPkg) {
  console.log('[graph] skip: @monomind/graph not found');
  process.exit(0);
}

fs.mkdirSync(graphDir, { recursive: true });

// Locate the enricher script — works for both monorepo layout and npm-install layout
const enricherCandidates = [
  path.join(projectDir, 'packages', '@monomind', 'cli', 'dist', 'src', 'graph', 'enrich.mjs'),
  path.join(projectDir, 'node_modules', '@monomind', 'cli', 'dist', 'src', 'graph', 'enrich.mjs'),
];
const enricherPath = enricherCandidates.find(p => fs.existsSync(p)) ?? null;
const hasEnricher = enricherPath !== null;

const { spawn } = require('child_process');
const script = [
  `import { buildGraph } from ${JSON.stringify('file://' + graphPkg)};`,
  `import fs from 'fs';`,
  `import path from 'path';`,
  `const projectDir = ${JSON.stringify(projectDir)};`,
  `const graphDir = ${JSON.stringify(graphDir)};`,
  `const statsFile = ${JSON.stringify(statsFile)};`,
  `buildGraph(projectDir, { codeOnly: true, outputDir: graphDir })`,
  `.then(async r => {`,
  `  fs.writeFileSync(statsFile, JSON.stringify({ nodes: r.analysis?.stats?.nodes, edges: r.analysis?.stats?.edges, files: r.filesProcessed, builtAt: Date.now() }));`,
  `  console.log('[graph] built: ' + r.filesProcessed + ' files, ' + (r.analysis?.stats?.nodes ?? '?') + ' nodes');`,
  hasEnricher ? [
    `  try {`,
    `    const { enrichGraph } = await import(${JSON.stringify('file://' + enricherPath)});`,
    `    const er = await enrichGraph(projectDir, { graphDir });`,
    `    console.log('[graph] enriched: ' + er.metrics.enrichedNodes + '/' + er.metrics.totalNodes + ' nodes');`,
    `  } catch (ee) { console.error('[graph] enrichment failed:', ee.message); }`,
  ].join('\n') : '',
  // Normalize graph.json: add snake_case field aliases expected by the MCP tools
  `  try {`,
  `    const graphPath = path.join(graphDir, 'graph.json');`,
  `    const raw = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));`,
  `    if (Array.isArray(raw.nodes)) {`,
  `      for (const n of raw.nodes) {`,
  `        n.source_file = n.sourceFile || '';`,
  `        n.source_location = n.sourceLocation || '';`,
  `        n.file_type = n.fileType || '';`,
  `        // Zero out degree for external symbols so they don't dominate god_nodes results`,
  `        if (!n.source_file) n.degree = 0;`,
  `      }`,
  `      fs.writeFileSync(graphPath, JSON.stringify(raw));`,
  `      console.log('[graph] normalized: added MCP field aliases to ' + raw.nodes.length + ' nodes');`,
  `    }`,
  `  } catch (ne) { console.error('[graph] normalize failed:', ne.message); }`,
  // Ensure .monobrain/graph symlink exists so the MCP server can locate the graph
  `  try {`,
  `    const monobrainDir = path.join(projectDir, '.monobrain');`,
  `    fs.mkdirSync(monobrainDir, { recursive: true });`,
  `    const symlinkTarget = path.join(monobrainDir, 'graph');`,
  `    let exists = false;`,
  `    try { fs.lstatSync(symlinkTarget); exists = true; } catch {}`,
  `    if (!exists) { fs.symlinkSync(graphDir, symlinkTarget); console.log('[graph] created .monobrain/graph symlink'); }`,
  `  } catch (se) { console.error('[graph] symlink setup failed:', se.message); }`,
  `})`,
  `.catch(e => console.error('[graph] build failed:', e.message));`,
].join('\n');

const logPath = path.join(graphDir, 'build.log');
let logFd;
try { logFd = fs.openSync(logPath, 'a'); } catch { logFd = 'ignore'; }
const child = spawn(process.execPath, ['--input-type=module'], {
  detached: true,
  stdio: ['pipe', logFd, logFd],
});
child.stdin.write(script);
child.stdin.end();
child.unref();

console.log('[graph] background build started for ' + projectDir);
