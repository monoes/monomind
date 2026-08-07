import fs from 'fs';
import path from 'path';

const _MAX_BUILD_DOCS_STATE = 500;

export async function handleMonographRoutes(req, res, url, corsOrigin, ctx) {
  // ------------------------------------------------------- GET /api/monograph-html
  if (req.method === 'GET' && url === '/api/monograph-html') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');

      // Generate HTML on-the-fly from SQLite DB
      if (fs.existsSync(dbPath)) {
        let html;
        try {
          // Try better-sqlite3 first (fast, in-process)
          const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
          const { toHtml } = await import(new URL('../../../../monograph/dist/src/export/html.js', import.meta.url).href);
          const db = openDb(dbPath);
          try {
            const rawNodes = db.prepare('SELECT * FROM nodes LIMIT 5000').all();
            const rawEdges = db.prepare('SELECT * FROM edges').all();
            const parsedNodes = rawNodes.map(n => ({
              id: n.id, label: n.label, name: n.name, normLabel: n.norm_label,
              filePath: n.file_path, startLine: n.start_line, endLine: n.end_line,
              communityId: n.community_id, isExported: !!n.is_exported,
              language: n.language, properties: n.properties ? JSON.parse(n.properties) : {},
            }));
            const parsedEdges = rawEdges.map(e => ({
              id: e.id, sourceId: e.source_id, targetId: e.target_id,
              relation: e.relation, confidence: e.confidence,
              confidenceScore: e.confidence_score, weight: e.weight,
            }));
            html = toHtml(parsedNodes, parsedEdges);
          } finally { closeDb(db); }
        } catch {
          // Fallback: sqlite3 CLI + inline Sigma.js graph
          const { execFileSync } = await import('child_process');
          const runSql = (sql) => {
            try { return JSON.parse(execFileSync('sqlite3', ['-json', dbPath], { encoding: 'utf-8', timeout: 15000, maxBuffer: 50*1024*1024, input: sql + ';' }) || '[]'); } catch { return []; }
          };
          const rawNodes = runSql('SELECT id, name, label, file_path, community_id FROM nodes LIMIT 2000');
          const rawEdges = runSql('SELECT source_id, target_id, relation FROM edges');
          const degree = new Map();
          for (const n of rawNodes) degree.set(n.id, 0);
          for (const e of rawEdges) {
            if (degree.has(e.source_id)) degree.set(e.source_id, (degree.get(e.source_id)||0)+1);
            if (degree.has(e.target_id)) degree.set(e.target_id, (degree.get(e.target_id)||0)+1);
          }
          const topNodes = [...rawNodes].sort((a,b) => (degree.get(b.id)||0)-(degree.get(a.id)||0)).slice(0,500);
          const topIds = new Set(topNodes.map(n => n.id));
          const filteredEdges = rawEdges.filter(e => topIds.has(e.source_id) && topIds.has(e.target_id)).slice(0,2000);
          const colors = ['#4E79A7','#F28E2B','#E15759','#76B7B2','#59A14F','#EDC948','#B07AA1','#FF9DA7','#9C755F','#BAB0AC'];
          const nodesJson = JSON.stringify(topNodes.map((n,i) => {
            const d = degree.get(n.id)||1;
            const c = n.community_id != null ? colors[n.community_id % colors.length] : colors[i % colors.length];
            return { id: n.id, label: n.name||n.id, x: Math.cos(i*0.618*Math.PI*2)*300+Math.random()*50, y: Math.sin(i*0.618*Math.PI*2)*300+Math.random()*50, size: Math.min(3+Math.sqrt(d)*2,20), color: c };
          }));
          const edgesJson = JSON.stringify(filteredEdges.map((e,i) => ({ id:'e'+i, source:e.source_id, target:e.target_id })));
          html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Monograph</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/sigma.js/2.4.0/sigma.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/graphology/0.25.4/graphology.umd.min.js"><\/script>
<style>*{margin:0;padding:0}body{background:#0f0f1a;overflow:hidden}#g{width:100vw;height:100vh}</style></head>
<body><div id="g"></div><script>
const g=new graphology.Graph();
${nodesJson}.forEach(n=>g.addNode(n.id,{label:n.label,x:n.x,y:n.y,size:n.size,color:n.color}));
${edgesJson}.forEach(e=>{try{g.addEdge(e.source,e.target,{size:0.5,color:'#333'})}catch{}});
new Sigma(g,document.getElementById('g'),{renderEdgeLabels:false,labelColor:{color:'#ccc'},labelSize:10});
<\/script></body></html>`;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}), 'Cache-Control': 'no-cache' });
        res.end(html);
        return true;
      }

      // Fallback: try legacy graph.html on disk
      const htmlPath = path.join(d, '.monomind', 'graph', 'graph.html');
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}), 'Cache-Control': 'no-cache' });
      res.end(html);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html><body style="background:#0f0f1a;color:#888;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h3 style="color:#4E79A7;">No Graph Built Yet</h3><p>Run <code style="color:#00E5C8;">mcp__monomind__monograph_build</code> or click BUILD in the sidebar.</p></div></body></html>');
    }
    return true;
  }

  // ------------------------------------------------------- GET /api/monograph-report
  if (req.method === 'GET' && url === '/api/monograph-report') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      let report = null, exists = false, stats = null;
      if (fs.existsSync(dbPath)) {
        exists = true;
        const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
        const db = openDb(dbPath);
        try {
          const nodeCount = db.prepare('SELECT COUNT(*) AS c FROM nodes').get().c;
          const edgeCount = db.prepare('SELECT COUNT(*) AS c FROM edges').get().c;
          const topNodes = db.prepare(`SELECT n.id, n.name, n.label, (SELECT COUNT(*) FROM edges e WHERE e.source_id=n.id OR e.target_id=n.id) AS deg FROM nodes n ORDER BY deg DESC LIMIT 20`).all();
          const labelDist = db.prepare('SELECT label, COUNT(*) AS cnt FROM nodes GROUP BY label ORDER BY cnt DESC LIMIT 10').all();
          const dbStat = fs.statSync(dbPath);
          stats = { nodes: nodeCount, edges: edgeCount, size: dbStat.size, mtime: dbStat.mtimeMs };
          report = [
            '# Monograph Knowledge Graph',
            '',
            `## Overview`,
            `- **Nodes**: ${nodeCount.toLocaleString()}`,
            `- **Edges**: ${edgeCount.toLocaleString()}`,
            `- **Last built**: ${new Date(dbStat.mtimeMs).toLocaleString()}`,
            '',
            '## Top 20 Nodes by Degree',
            ...topNodes.map((n, i) => `${String(i+1).padStart(3,' ')}. **${n.name || n.id}** \`${n.label}\` — ${n.deg} connections`),
            '',
            '## Node Type Distribution',
            ...labelDist.map(r => `- **${r.label}**: ${r.cnt}`),
          ].join('\n');
        } finally { closeDb(db); }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}), 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ exists, report, stats }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-graph
  if (req.method === 'GET' && url === '/api/monograph-graph') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      let nodes = [], edges = [];
      if (fs.existsSync(dbPath)) {
        const { execFileSync } = await import('child_process');
        const runSql = (sql, timeout = 10000) => {
          try {
            return JSON.parse(execFileSync('sqlite3', ['-json', dbPath],
              { encoding: 'utf-8', timeout, maxBuffer: 50 * 1024 * 1024, input: sql + ';' }) || '[]');
          } catch { return []; }
        };
        const nodeLimit = Math.min(parseInt(qs.get('limit') || '500', 10), 5000);
        const labelFilter = qs.get('labels') ? qs.get('labels').split(',').map(s => s.trim()) : null;
        const rawNodes = labelFilter
          ? runSql(`SELECT id, name, label, file_path, community_id FROM nodes WHERE label IN (${labelFilter.map(l => "'" + l.replace(/'/g, "''") + "'").join(',')}) LIMIT 5000`)
          : runSql(`SELECT id, name, label, file_path, community_id FROM nodes LIMIT 5000`);
        const rawEdges = runSql('SELECT source_id, target_id, relation FROM edges');
        const degree = new Map();
        for (const n of rawNodes) degree.set(n.id, 0);
        for (const e of rawEdges) {
          if (degree.has(e.source_id)) degree.set(e.source_id, (degree.get(e.source_id) || 0) + 1);
          if (degree.has(e.target_id)) degree.set(e.target_id, (degree.get(e.target_id) || 0) + 1);
        }
        const topNodes = labelFilter
          ? rawNodes
          : [...rawNodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)).slice(0, nodeLimit);
        const topIds = new Set(topNodes.map(n => n.id));
        nodes = topNodes.map(n => ({ id: n.id, label: n.name || n.id, type: n.label || 'unknown', degree: degree.get(n.id) || 0 }));
        edges = rawEdges.filter(e => topIds.has(e.source_id) && topIds.has(e.target_id)).slice(0, 2000).map(e => ({ source: e.source_id, target: e.target_id, relation: e.relation || 'REF' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}), 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ nodes, edges }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- POST /api/ua-enrich
  // Trigger semantic enrichment on an existing monograph DB.
  // Imports understand graph.json if present; falls back to structural-only pass.
  if (req.method === 'POST' && url === '/api/ua-enrich') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const dbFilePath = path.join(d, '.monomind', 'monograph.db');

      // Check for UA graph.json first
      const uaGraphCandidates = [
        path.join(d, '.understand-anything', 'knowledge-graph.json'),
        path.join(d, '.understand-anything', 'graph.json'),
        path.join(d, '.ua', 'knowledge-graph.json'),
        path.join(d, '.ua', 'graph.json'),
      ];
      const uaGraph = uaGraphCandidates.find(p => fs.existsSync(p));
      const importScript = path.join(process.cwd(), 'scripts', 'ua-import.mjs');
      const enrichScript = path.join(process.cwd(), 'scripts', 'ua-enrich.mjs');

      res.writeHead(202, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });

      if (uaGraph && fs.existsSync(importScript)) {
        res.end(JSON.stringify({ status: 'importing', source: uaGraph }));
        const { spawn: sp } = await import('child_process');
        const child = sp(process.execPath, [importScript, uaGraph, dbFilePath], { stdio: 'ignore', detached: true, cwd: d });
        child.unref();
      } else if (fs.existsSync(enrichScript)) {
        res.end(JSON.stringify({ status: 'enriching', mode: 'structural-only' }));
        const { spawn: sp } = await import('child_process');
        const child = sp(process.execPath, [enrichScript, '--dir', d, '--db', dbFilePath, '--full'], { stdio: 'ignore', detached: true, cwd: d });
        child.unref();
      } else {
        res.end(JSON.stringify({ status: 'skipped', reason: 'No understand graph.json found. Run /monomind:understand in Claude Code first.' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- POST /api/monograph-build
  if (req.method === 'POST' && url === '/api/monograph-build') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());

      // Security: this route spawns `node --eval` with `cwd: d`, which lets
      // Node resolve '@monoes/monograph' against d's node_modules. Only ever
      // allow this for the server's own project root — never an
      // attacker-controlled `?dir=` — since a planted node_modules there
      // would achieve RCE. (See P0-6.)
      const _serverRoot = path.resolve(ctx.projectDir || process.cwd());
      if (d !== _serverRoot) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
        res.end(JSON.stringify({ error: 'monograph-build only supports the server project root' }));
        return true;
      }

      res.writeHead(202, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ status: 'building', dir: d }));

      // Build via monograph in background
      const { spawn: sp } = await import('child_process');
      const script = `import { buildAsync } from '@monoes/monograph'; await buildAsync(${JSON.stringify(d)});`;
      const child = sp(process.execPath, ['--input-type=module', '--eval', script], { stdio: 'ignore', detached: true, cwd: d });
      child.unref();
      console.log(`[graph] build started for ${d} via monograph`);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-build-docs-status
  if (req.method === 'GET' && url === '/api/monograph-build-docs-status') {
    const qs2 = new URL(req.url, 'http://localhost').searchParams;
    const d2 = path.resolve(qs2.get('dir') || ctx.projectDir || process.cwd());
    const state = ctx.buildDocsState.get(d2) || { status: 'idle' };
    res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
    res.end(JSON.stringify(state));
    return true;
  }

  // -------------------------------------------------- POST /api/monograph-build-docs
  if (req.method === 'POST' && url === '/api/monograph-build-docs') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!fs.existsSync(dbPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
        res.end(JSON.stringify({ error: 'monograph.db not found — run BUILD GRAPH first' }));
        return true;
      }

      // Reject if already running
      const existing = ctx.buildDocsState.get(d);
      if (existing && existing.status === 'pending') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
        res.end(JSON.stringify({ status: 'pending', message: 'Build already in progress' }));
        return true;
      }

      const startedAt = Date.now();
      if (!ctx.buildDocsState.has(d) && ctx.buildDocsState.size >= _MAX_BUILD_DOCS_STATE) {
        const oldest = ctx.buildDocsState.keys().next().value;
        ctx.buildDocsState.delete(oldest);
      }
      ctx.buildDocsState.set(d, { status: 'pending', sections: 0, files: 0, error: null, startedAt });
      res.writeHead(202, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ status: 'pending', dir: d }));

      // Run doc parsing in background
      (async () => {
        const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
        const { isFileCached, updateFileCache, hashFileContent } = await import(new URL('../../../../monograph/dist/src/storage/file-cache.js', import.meta.url).href);
        const { readFileSync, readdirSync, statSync } = fs;

        const docExts = new Set(['.md', '.mdx', '.txt', '.rst']);
        const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', '.monomind', '__pycache__', 'vendor']);
        const docFiles = [];
        function walk(dir2, depth = 0) {
          if (depth > 12) return;
          let entries;
          try { entries = readdirSync(dir2); } catch { return; }
          for (const e of entries) {
            if (ignoreDirs.has(e) || e.startsWith('.')) continue;
            const full = path.join(dir2, e);
            let st;
            try { st = statSync(full); } catch { continue; }
            if (st.isDirectory()) { walk(full, depth + 1); }
            else if (docExts.has(path.extname(e).toLowerCase()) && st.size < 600000) docFiles.push(full);
          }
        }
        walk(d);

        const db = openDb(dbPath);
        try {
          const insertNode = db.prepare(`INSERT OR REPLACE INTO nodes (id, label, name, norm_label, file_path, start_line, end_line, language, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`);
          const insertEdge = db.prepare(`INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score, weight) VALUES (?, ?, ?, ?, 'EXTRACTED', 1.0, 1.0)`);

          const insertAll = db.transaction((nodes, edges) => {
            for (const n of nodes) {
              try { insertNode.run(n.id, n.label, n.name, n.norm_label, n.file_path, n.start_line, n.end_line, n.language); } catch {}
            }
            for (const e of edges) { try { insertEdge.run(e.id, e.src, e.dst, e.rel); } catch {} }
          });

          const normTitle = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

          let totalSections = 0;
          let skipped = 0;
          for (const filePath of docFiles) {
            let content;
            try { content = readFileSync(filePath, 'utf-8'); } catch { continue; }

            // Skip unchanged files using file cache
            let isCached = false;
            let contentHash = '';
            try {
              contentHash = hashFileContent(content);
              isCached = isFileCached(db, filePath, contentHash);
            } catch {}
            if (isCached) { skipped++; continue; }
            const relPath = path.relative(d, filePath);
            const ext = path.extname(filePath).slice(1).toLowerCase();
            const fileId = 'doc:' + relPath;
            const lineCount = content.split('\n').length;

            const nodes = [{ id: fileId, label: 'File', name: relPath, norm_label: normTitle(relPath), file_path: relPath, start_line: 1, end_line: lineCount, language: ext }];
            const edges = [];
            const lines = content.split('\n');
            const sectionStack = [{ id: fileId, depth: 0 }];
            let inCodeBlock = false;
            let codeBlockLang = null;

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];

              // Track fenced code blocks — don't parse headings inside them
              const fenceMatch = line.match(/^```([a-zA-Z0-9_+-]*)$/);
              if (fenceMatch) {
                if (!inCodeBlock) {
                  inCodeBlock = true;
                  codeBlockLang = fenceMatch[1].trim() || null;
                  if (codeBlockLang) {
                    const cId = 'concept:lang:' + codeBlockLang.toLowerCase();
                    if (!nodes.find(n => n.id === cId)) {
                      nodes.push({ id: cId, label: 'Concept', name: codeBlockLang, norm_label: normTitle(codeBlockLang), file_path: null, start_line: 0, end_line: 0, language: null });
                    }
                    const curSec = sectionStack[sectionStack.length - 1].id;
                    edges.push({ id: 'e:' + curSec + ':' + cId + ':code', src: curSec, dst: cId, rel: 'TAGGED_AS' });
                  }
                } else { inCodeBlock = false; codeBlockLang = null; }
                continue;
              }
              if (inCodeBlock) continue;

              // ATX headings: # Title
              const hMatch = line.match(/^(#{1,6})\s+(.+)/);
              if (hMatch) {
                const depth = hMatch[1].length;
                const title = hMatch[2].trim().replace(/\s+#+\s*$/, '').trim();
                const secId = 'sec:' + relPath + ':' + (i + 1);
                nodes.push({ id: secId, label: 'Section', name: title, norm_label: normTitle(title), file_path: relPath, start_line: i + 1, end_line: i + 1, language: ext });
                totalSections++;
                while (sectionStack.length > 1 && sectionStack[sectionStack.length - 1].depth >= depth) sectionStack.pop();
                const parentId = sectionStack[sectionStack.length - 1].id;
                edges.push({ id: 'e:' + secId + ':' + parentId + ':parent', src: parentId, dst: secId, rel: 'DEFINES' });
                sectionStack.push({ id: secId, depth });
                continue;
              }

              // RST-style headings: line followed by ===, ---, ~~~, ^^^, etc.
              if (i + 1 < lines.length && lines[i + 1].match(/^[=\-~^"'`#*+!]{3,}\s*$/) && line.trim().length > 0 && line.trim().length <= lines[i + 1].trim().length + 2) {
                const underlineChar = lines[i + 1].trim()[0];
                const rstDepth = '=-~^"\'`#*+!'.indexOf(underlineChar) + 1 || 3;
                const title = line.trim();
                const secId = 'sec:' + relPath + ':' + (i + 1);
                nodes.push({ id: secId, label: 'Section', name: title, norm_label: normTitle(title), file_path: relPath, start_line: i + 1, end_line: i + 1, language: ext });
                totalSections++;
                const depth = Math.min(6, Math.ceil(rstDepth / 2));
                while (sectionStack.length > 1 && sectionStack[sectionStack.length - 1].depth >= depth) sectionStack.pop();
                const parentId = sectionStack[sectionStack.length - 1].id;
                edges.push({ id: 'e:' + secId + ':' + parentId + ':parent', src: parentId, dst: secId, rel: 'DEFINES' });
                sectionStack.push({ id: secId, depth });
                i++; // skip underline line
                continue;
              }

              // #hashtag concepts (skip markdown headings already matched)
              const tags = line.match(/#([a-zA-Z][a-zA-Z0-9_-]{2,})/g);
              if (tags) {
                for (const tag of tags) {
                  const concept = tag.slice(1);
                  const cId = 'concept:tag:' + concept.toLowerCase();
                  if (!nodes.find(n => n.id === cId)) {
                    nodes.push({ id: cId, label: 'Concept', name: concept, norm_label: normTitle(concept), file_path: null, start_line: 0, end_line: 0, language: null });
                  }
                  const curSec = sectionStack[sectionStack.length - 1].id;
                  edges.push({ id: 'e:' + curSec + ':' + cId + ':tag', src: curSec, dst: cId, rel: 'TAGGED_AS' });
                }
              }
            }

            try {
              insertAll(nodes, edges);
              // Update file cache so we skip unchanged files next run
              try {
                updateFileCache(db, { filePath, contentHash, lastParsed: Date.now(), nodeCount: nodes.length, edgeCount: edges.length });
              } catch {}
            } catch (e) { console.error('[docs-build] error inserting', relPath, e.message); }
          }
          console.log(`[docs-build] indexed ${docFiles.length - skipped} docs (${skipped} cached), ${totalSections} sections → ${dbPath}`);
          ctx.buildDocsState.set(d, { status: 'done', sections: totalSections, files: docFiles.length - skipped, cached: skipped, error: null, startedAt, completedAt: Date.now() });
        } finally { closeDb(db); }
      })().catch(e => {
        console.error('[docs-build] fatal:', e.message);
        ctx.buildDocsState.set(d, { status: 'error', sections: 0, files: 0, error: e.message, startedAt, completedAt: Date.now() });
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-content
  // Returns actual file content for a node (properties.content or file slice)
  if (req.method === 'GET' && url === '/api/monograph-content') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const id = qs.get('id') || '';
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!id) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?id=' })); return true; }
      if (!fs.existsSync(dbPath)) { res.writeHead(404); res.end(JSON.stringify({ error: 'Graph not built' })); return true; }
      const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
      const db = openDb(dbPath);
      let content = '', filePath = '', startLine = 0, endLine = 0, language = '', name = '', type = '';
      try {
        const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(id);
        if (!node) { res.writeHead(404); res.end(JSON.stringify({ error: 'Node not found' })); return true; }
        name = node.name || id;
        type = node.label || 'Unknown';
        filePath = node.file_path || '';
        startLine = node.start_line || 0;
        endLine = node.end_line || 0;
        language = node.language || '';
        // Try properties.content first (from official monograph pipeline)
        if (node.properties) {
          try {
            const props = JSON.parse(node.properties);
            if (props.content && props.content.trim()) { content = props.content; }
          } catch {}
        }
        // Fallback: read from actual file
        if (!content && filePath) {
          const absPath = path.isAbsolute(filePath) ? filePath : path.join(d, filePath);
          try {
            const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
            const sl = Math.max(0, (startLine || 1) - 1);
            const el = Math.min(lines.length, (endLine || startLine || lines.length) + 5);
            content = lines.slice(sl, Math.min(el, sl + 120)).join('\n');
          } catch {}
        }
      } finally { closeDb(db); }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ content, filePath, startLine, endLine, language, name, type }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-fts
  // Full-text search with content snippets — powers the wiki search box
  if (req.method === 'GET' && url === '/api/monograph-fts') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      // Cap ?q= to prevent DoS via megabyte FTS query strings.
      const q = (qs.get('q') || '').trim().slice(0, 4096);
      const limit = Math.min(100, parseInt(qs.get('limit') || '50', 10));
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?q=' })); return true; }
      if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) }); res.end(JSON.stringify({ nodes: [] })); return true; }
      const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
        const { ftsSearch } = await import(new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href);
      const db = openDb(dbPath);
      let nodes = [];
      try {
        const hits = ftsSearch(db, q, limit);
        nodes = hits.map(h => {
          let snippet = '';
          if (h.properties) { try { const p = JSON.parse(h.properties); snippet = (p.content || '').slice(0, 200); } catch {} }
          return { id: h.id, label: h.name, type: h.label, degree: 0, filePath: h.filePath || h.file_path, startLine: h.startLine || h.start_line, snippet };
        });
      } finally { closeDb(db); }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ nodes }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-related
  // BFS from a node — returns node IDs sorted by graph distance (for re-ranking)
  if (req.method === 'GET' && url === '/api/monograph-related') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const id = qs.get('id') || '';
      const limit = Math.min(200, parseInt(qs.get('limit') || '60', 10));
      const maxDepth = Math.min(4, parseInt(qs.get('depth') || '3', 10));
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!id || !fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) }); res.end(JSON.stringify({ related: [] })); return true; }
      const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
      const db = openDb(dbPath);
      const related = [];
      try {
        const visited = new Set([id]);
        let frontier = [id];
        for (let depth = 1; depth <= maxDepth && frontier.length > 0 && related.length < limit; depth++) {
          const next = [];
          for (const nodeId of frontier) {
            const rows = db.prepare(`SELECT DISTINCT target_id as nid FROM edges WHERE source_id=? UNION SELECT DISTINCT source_id as nid FROM edges WHERE target_id=? LIMIT 30`).all(nodeId, nodeId);
            for (const r of rows) {
              if (!visited.has(r.nid)) {
                visited.add(r.nid);
                next.push(r.nid);
                related.push({ id: r.nid, distance: depth });
                if (related.length >= limit) break;
              }
            }
            if (related.length >= limit) break;
          }
          frontier = next;
        }
      } finally { closeDb(db); }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ related }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-ai-context
  // Builds a rich AI context bundle for a node: content + 1-hop neighbors
  if (req.method === 'GET' && url === '/api/monograph-ai-context') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const id = qs.get('id') || '';
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!id || !fs.existsSync(dbPath)) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return true; }
      const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
      const db = openDb(dbPath);
      let result = { node: null, content: '', neighbors: [], markdown: '' };
      try {
        const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(id);
        if (!node) { res.writeHead(404); res.end(JSON.stringify({ error: 'Node not found' })); return true; }
        result.node = { id: node.id, name: node.name, type: node.label, filePath: node.file_path, startLine: node.start_line, endLine: node.end_line };
        // Get content
        let content = '';
        if (node.properties) { try { const p = JSON.parse(node.properties); content = p.content || ''; } catch {} }
        if (!content && node.file_path) {
          const absPath = path.isAbsolute(node.file_path) ? node.file_path : path.join(d, node.file_path);
          try {
            const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
            const sl = Math.max(0, (node.start_line || 1) - 1);
            const el = Math.min(lines.length, (node.end_line || node.start_line || lines.length) + 5);
            content = lines.slice(sl, Math.min(el, sl + 80)).join('\n');
          } catch {}
        }
        result.content = content;
        // Get 1-hop neighbors
        const outEdges = db.prepare('SELECT e.relation, n.id, n.name, n.label, n.file_path FROM edges e JOIN nodes n ON n.id=e.target_id WHERE e.source_id=? LIMIT 20').all(id);
        const inEdges = db.prepare('SELECT e.relation, n.id, n.name, n.label, n.file_path FROM edges e JOIN nodes n ON n.id=e.source_id WHERE e.target_id=? LIMIT 20').all(id);
        result.neighbors = [
          ...outEdges.map(e => ({ direction: 'out', relation: e.relation, id: e.id, name: e.name, type: e.label, filePath: e.file_path })),
          ...inEdges.map(e => ({ direction: 'in', relation: e.relation, id: e.id, name: e.name, type: e.label, filePath: e.file_path })),
        ];
        // Build markdown for clipboard/AI
        const lines2 = [];
        lines2.push(`# ${node.name} [${node.label}]`);
        if (node.file_path) lines2.push(`**File:** \`${node.file_path}\`${node.start_line ? ` (line ${node.start_line})` : ''}`);
        if (content) lines2.push(`\n\`\`\`${node.language || ''}\n${content.slice(0, 3000)}\n\`\`\``);
        if (outEdges.length) {
          lines2.push(`\n**Depends on (${outEdges.length}):**`);
          outEdges.forEach(e => lines2.push(`- ${e.relation} → ${e.name} [${e.label}]${e.file_path ? ' `' + e.file_path + '`' : ''}`));
        }
        if (inEdges.length) {
          lines2.push(`\n**Used by (${inEdges.length}):**`);
          inEdges.forEach(e => lines2.push(`- ${e.relation} ← ${e.name} [${e.label}]${e.file_path ? ' `' + e.file_path + '`' : ''}`));
        }
        result.markdown = lines2.join('\n');
      } finally { closeDb(db); }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-query
  if (req.method === 'GET' && url === '/api/monograph-query') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const q = (qs.get('q') || '').trim().slice(0, 4096);
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?q= parameter' })); return true; }
      if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) }); res.end(JSON.stringify({ success: false, result: 'Graph not built yet. Run: monomind monograph build' })); return true; }
      const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
        const { ftsSearch } = await import(new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href);
      const db = openDb(dbPath);
      let result = '';
      try {
        const hits = ftsSearch(db, q, 20);
        if (!hits.length) {
          result = `No matches found for: "${q}"`;
        } else {
          result = hits.map((h, i) => `${String(i+1).padStart(3,' ')}. ${h.name} [${h.normLabel}]${h.filePath ? '\n     ' + h.filePath : ''}`).join('\n');
          // Show outgoing edges for top hit
          const topHit = hits[0];
          const neighbors = db.prepare('SELECT target_id, relation FROM edges WHERE source_id=? LIMIT 10').all(topHit.id);
          if (neighbors.length) {
            result += `\n\n── ${topHit.name} references:\n` + neighbors.map(n => `   ${n.relation} → ${n.target_id.split('/').pop() || n.target_id}`).join('\n');
          }
        }
      } finally { closeDb(db); }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ success: true, query: q, result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-explain
  if (req.method === 'GET' && url === '/api/monograph-explain') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const nodeQ = (qs.get('node') || '').trim().slice(0, 4096);
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!nodeQ) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?node= parameter' })); return true; }
      if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) }); res.end(JSON.stringify({ success: false, explanation: 'Graph not built yet. Run: monomind monograph build' })); return true; }
      const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
        const { ftsSearch } = await import(new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href);
      const db = openDb(dbPath);
      let explanation = '';
      try {
        let nd = db.prepare('SELECT * FROM nodes WHERE id=?').get(nodeQ) || db.prepare('SELECT * FROM nodes WHERE name=?').get(nodeQ);
        if (!nd) { const hits = ftsSearch(db, nodeQ, 1); if (hits[0]) nd = db.prepare('SELECT * FROM nodes WHERE id=?').get(hits[0].id); }
        if (!nd) {
          explanation = `No node found matching: "${nodeQ}"`;
        } else {
          const outEdges = db.prepare('SELECT target_id, relation FROM edges WHERE source_id=? LIMIT 20').all(nd.id);
          const inEdges = db.prepare('SELECT source_id, relation FROM edges WHERE target_id=? LIMIT 20').all(nd.id);
          explanation = [
            `## ${nd.name} [${nd.label}]`,
            nd.file_path ? `File: ${nd.file_path}${nd.start_line ? ':' + nd.start_line : ''}` : '',
            nd.language ? `Language: ${nd.language}` : '',
            nd.is_exported ? 'Exported: yes' : 'Exported: no',
            '',
            outEdges.length ? `References (${outEdges.length}):\n` + outEdges.map(e => `  ${e.relation} → ${e.target_id.split('/').pop() || e.target_id}`).join('\n') : 'No outgoing references.',
            inEdges.length ? `\nReferenced by (${inEdges.length}):\n` + inEdges.map(e => `  ${e.source_id.split('/').pop() || e.source_id} [${e.relation}]`).join('\n') : '',
          ].filter(Boolean).join('\n');
        }
      } finally { closeDb(db); }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ success: true, node: nodeQ, explanation }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-path
  if (req.method === 'GET' && url === '/api/monograph-path') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const from = (qs.get('from') || '').trim().slice(0, 4096);
      const to = (qs.get('to') || '').trim().slice(0, 4096);
      const d = path.resolve(dir || process.cwd());
      const dbPath = path.join(d, '.monomind', 'monograph.db');
      if (!from || !to) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing ?from= and ?to= parameters' })); return true; }
      if (!fs.existsSync(dbPath)) { res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) }); res.end(JSON.stringify({ success: false, path: 'Graph not built yet.' })); return true; }
      // Import only graphology-free storage modules to avoid broken graphology dep
      const { openDb, closeDb } = await import(new URL('../../../../monograph/dist/src/storage/db.js', import.meta.url).href);
      const { ftsSearch } = await import(new URL('../../../../monograph/dist/src/storage/fts-store.js', import.meta.url).href);
      // SQL-based BFS for shortest path (avoids graphology)
      const getShortestPath = (db, fromId, toId, maxDepth = 6) => {
        if (fromId === toId) return [fromId];
        const visited = new Set([fromId]);
        let frontier = [[fromId]];
        for (let depth = 0; depth < maxDepth; depth++) {
          const next = [];
          for (const chain of frontier) {
            const cur = chain[chain.length - 1];
            const neighbors = db.prepare('SELECT target_id AS id FROM edges WHERE source_id=? UNION SELECT source_id AS id FROM edges WHERE target_id=?').all(cur, cur);
            for (const { id } of neighbors) {
              if (!visited.has(id)) {
                const newChain = [...chain, id];
                if (id === toId) return newChain;
                visited.add(id);
                next.push(newChain);
              }
            }
          }
          if (!next.length) break;
          frontier = next;
        }
        return null;
      };
      const db = openDb(dbPath);
      let pathResult = '';
      try {
        const resolveId = (q) => {
          const direct = db.prepare('SELECT id FROM nodes WHERE id=? OR name=?').get(q, q);
          if (direct) return direct.id;
          const hits = ftsSearch(db, q, 1);
          return hits[0]?.id || q;
        };
        const fromId = resolveId(from);
        const toId = resolveId(to);
        const p = getShortestPath(db, fromId, toId);
        if (!p || !p.length) {
          pathResult = `No path found between "${from}" and "${to}"`;
        } else {
          const names = p.map(id => { const n = db.prepare('SELECT name FROM nodes WHERE id=?').get(id); return n ? n.name : id.split('/').pop() || id; });
          pathResult = names.join(' → ') + `  (${p.length - 1} hop${p.length !== 2 ? 's' : ''})`;
        }
      } finally { closeDb(db); }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ success: true, from, to, path: pathResult }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-watch-status
  if (req.method === 'GET' && url === '/api/monograph-watch-status') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      let running = false, pid = null;
      for (const pidName of ['monograph.watch.pid', 'monograph-watch.pid']) {
        try {
          const pp = path.join(d, '.monomind', pidName);
          pid = parseInt(fs.readFileSync(pp, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          if (!ctx.looksLikeOurProcess(pid, d)) continue;
          running = true;
          break;
        } catch {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ running, pid }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- POST /api/monograph-watch-toggle
  if (req.method === 'POST' && url === '/api/monograph-watch-toggle') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const pidPath = path.join(d, '.monomind', 'monograph.watch.pid');
      let wasRunning = false;
      for (const pidName of ['monograph.watch.pid', 'monograph-watch.pid']) {
        try {
          const pp = path.join(d, '.monomind', pidName);
          const pid = parseInt(fs.readFileSync(pp, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          if (!ctx.looksLikeOurProcess(pid, d)) continue;
          wasRunning = true;
          process.kill(pid, 'SIGTERM');
          try { fs.unlinkSync(pp); } catch {}
        } catch {}
      }

      if (wasRunning) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
        res.end(JSON.stringify({ running: false, action: 'stopped' }));
      } else {
        const { spawn: sp } = await import('child_process');
        const child = sp(process.execPath, [process.argv[1], 'monograph', 'watch'], { stdio: 'ignore', detached: true, cwd: d, env: process.env });
        child.unref();
        try { fs.mkdirSync(path.join(d, '.monomind'), { recursive: true }); } catch {}
        try { fs.writeFileSync(pidPath, String(child.pid)); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
        res.end(JSON.stringify({ running: true, pid: child.pid, action: 'started' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // -------------------------------------------------- GET /api/monograph-benchmark
  if (req.method === 'GET' && url === '/api/monograph-benchmark') {
    try {
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const dir = qs.get('dir') || ctx.projectDir || process.cwd();
      const d = path.resolve(dir || process.cwd());
      const graphPath = path.join(d, '.monomind', 'graph', 'graph.json');
      const legacyPath = path.join(d, 'graphify-out', 'graph.json');
      const gp = fs.existsSync(graphPath) ? graphPath : (fs.existsSync(legacyPath) ? legacyPath : null);

      if (!gp) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
        res.end(JSON.stringify({ available: false }));
        return true;
      }

      const { execSync: ex } = await import('child_process');
      const out = ex(`graphify benchmark ${gp}`, { encoding: 'utf8', cwd: d, timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
      res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
      res.end(JSON.stringify({ available: true, result: out }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Reads .monomind/monograph.db via sqlite3 CLI to avoid bundling better-sqlite3.
  if (req.method === 'GET' && url === '/api/monograph') {
    try {
      const dbPath = path.join(ctx.projectDir || process.cwd(), '.monomind', 'monograph.db');
      if (!fs.existsSync(dbPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exists: false }));
        return true;
      }
      const { execFileSync } = await import('child_process');
      // Pipe SQL via stdin to avoid shell quoting issues with single-quoted SQL strings.
      const runSql = (sql, timeout = 5000) => {
        try {
          return execFileSync('sqlite3', ['-json', dbPath],
            { encoding: 'utf-8', timeout: timeout, input: sql + ';' });
        } catch (e) { return '[]'; }
      };
      const counts = JSON.parse(runSql(
        "SELECT (SELECT COUNT(*) FROM nodes) AS nodes, (SELECT COUNT(*) FROM edges) AS edges;"
      ) || '[{}]')[0] || { nodes: 0, edges: 0 };
      // Compute degree in one pass via GROUP BY (much faster than per-row subquery).
      const gods = JSON.parse(runSql(
        "WITH deg(node_id, d) AS (" +
        "  SELECT source_id, COUNT(*) FROM edges GROUP BY source_id " +
        "  UNION ALL " +
        "  SELECT target_id, COUNT(*) FROM edges GROUP BY target_id" +
        "), totals AS (" +
        "  SELECT node_id, SUM(d) AS deg FROM deg GROUP BY node_id" +
        ") " +
        "SELECT n.name, n.label, n.file_path, t.deg " +
        "FROM nodes n JOIN totals t ON t.node_id = n.id " +
        "WHERE n.label NOT IN ('Concept') " +
        "AND n.file_path IS NOT NULL AND n.file_path != '' " +
        "AND n.name NOT LIKE '(%' AND length(n.name) >= 3 " +
        "ORDER BY t.deg DESC LIMIT 20",
        10000
      ) || '[]');
      const types = JSON.parse(runSql(
        "SELECT label, COUNT(*) AS count FROM nodes GROUP BY label ORDER BY count DESC LIMIT 12"
      ) || '[]');
      const relations = JSON.parse(runSql(
        "SELECT relation, COUNT(*) AS count FROM edges GROUP BY relation ORDER BY count DESC"
      ) || '[]');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        exists: true,
        nodes: counts.nodes,
        edges: counts.edges,
        godNodes: gods,
        typeDistribution: types,
        relationDistribution: relations,
        updatedAt: (() => { try { return fs.statSync(dbPath).mtime; } catch { return null; } })(),
      }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exists: true, nodes: 0, edges: 0, godNodes: [], typeDistribution: [], relationDistribution: [], error: String(err) }));
    }
    return true;
  }

  return false;
}
