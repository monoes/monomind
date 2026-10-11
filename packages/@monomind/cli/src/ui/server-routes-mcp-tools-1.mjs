// Tool-name dispatch for POST /api/mcp/call, part 1 of 2 (split for file size).
// Registered, in order, by handleMcpCallRoutes in server-routes-mcp-call.mjs.
// mcpCtx: { tool, input, args, db2, ok, err, d2, _getShortestPath }.
async function handleMcpToolsPart1(mcpCtx) {
  const { tool, input, db2, ok, d2, ftsSearch, countNodes, countEdges } = mcpCtx;
  if (tool === 'monograph_stats') {
    const n = countNodes(db2),
      e = countEdges(db2);
    ok(`nodes: ${n}\nedges: ${e}`);
  } else if (tool === 'monograph_cypher') {
    // Translate basic MATCH (n:Label) queries to SQL
    const q = String(input.query || '')
      .trim()
      .slice(0, 4096);
    const labelMatch = q.match(/MATCH\s+\(n:(\w+)\)/i);
    if (labelMatch) {
      const label = labelMatch[1];
      const rows = db2.prepare('SELECT name FROM nodes WHERE label = ? LIMIT 5000').all(label);
      ok(rows.map((r) => r.name).join('\n'));
    } else {
      ok('Cypher: unsupported query pattern');
    }
  } else if (tool === 'monograph_cohesion') {
    const limit = input.limit || 30;
    // Check if community_id is populated
    const hasCommunities =
      db2.prepare('SELECT COUNT(*) as c FROM nodes WHERE community_id IS NOT NULL').get().c > 0;
    if (hasCommunities) {
      const rows = db2
        .prepare(
          'SELECT community_id, COUNT(*) as size FROM nodes GROUP BY community_id ORDER BY size DESC LIMIT ?',
        )
        .all(limit);
      ok(rows.map((r) => `community ${r.community_id}: ${r.size} nodes`).join('\n'));
    } else {
      // Fallback: group by type (label)
      const rows = db2
        .prepare(
          'SELECT label, COUNT(*) as cnt FROM nodes GROUP BY label ORDER BY cnt DESC LIMIT ?',
        )
        .all(limit);
      const total = db2.prepare('SELECT COUNT(*) as c FROM nodes').get().c;
      const lines = rows.map((r) => {
        const pct = ((r.cnt / total) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(pct / 3));
        return `${(r.label || 'unknown').padEnd(12)} ${r.cnt.toString().padStart(6)} nodes  (${pct}%)  ${bar}`;
      });
      ok(
        `Type Distribution (community clustering not yet run)\n${'─'.repeat(50)}\n${lines.join('\n')}`,
      );
    }
  } else if (tool === 'monograph_bridge') {
    const limit = input.limit || 20;
    // Find hub nodes that connect many different directories (cross-module connectors)
    const rows = db2
      .prepare(`
                SELECT n.name, n.label, n.file_path,
                  COUNT(DISTINCT CASE WHEN e.source_id = n.id THEN n2.file_path ELSE NULL END) +
                  COUNT(DISTINCT CASE WHEN e.target_id = n.id THEN n2.file_path ELSE NULL END) as cross_file_count,
                  (SELECT COUNT(*) FROM edges WHERE source_id = n.id OR target_id = n.id) as total_degree
                FROM nodes n
                JOIN edges e ON e.source_id = n.id OR e.target_id = n.id
                JOIN nodes n2 ON (e.source_id = n2.id OR e.target_id = n2.id) AND n2.id != n.id
                GROUP BY n.id
                HAVING cross_file_count > 2
                ORDER BY cross_file_count DESC, total_degree DESC
                LIMIT ?`)
      .all(limit);
    if (!rows.length) {
      ok(
        'No cross-module bridge nodes found in top results. Try running monograph build to index more files.',
      );
    } else {
      const lines = rows.map(
        (r) =>
          `${r.name} (${r.label})\n  → connects ${r.cross_file_count} files, degree ${r.total_degree}\n  ${r.file_path || '?'}`,
      );
      ok(`Cross-Module Bridge Nodes (${rows.length})\n${'─'.repeat(50)}\n${lines.join('\n\n')}`);
    }
  } else if (tool === 'monograph_detect_changes') {
    const { execSync } = await import('node:child_process');
    let changed = '';
    try {
      changed = execSync('git diff --name-only HEAD', {
        cwd: d2,
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch {
      changed = '(git not available)';
    }
    ok(changed.trim() || 'No changed files detected');
  } else if (tool === 'monograph_diff') {
    ok('Graph diff: compare two snapshots using monograph snapshot + monograph diff commands');
  } else if (tool === 'monograph_rename') {
    // Cap sym to prevent O(n) FTS scan DoS via oversized query string.
    const sym = String(input.symbolName || '').slice(0, 4096);
    if (!sym) {
      ok('Provide symbolName to rename');
      return;
    }
    const hits = ftsSearch(db2, sym, 20);
    ok(
      `Found ${hits.length} occurrences of "${sym}":\n` +
        hits.map((h) => `  ${h.filePath || '?'}:${h.startLine || '?'} — ${h.name}`).join('\n'),
    );
  } else if (tool === 'monograph_impact') {
    const target = String(input.target || '').slice(0, 4096);
    const dir3 = input.direction || 'both';
    const depth = input.maxDepth || 4;
    const hits = ftsSearch(db2, target, 5);
    if (!hits.length) {
      ok(`Node not found: ${target}`);
      return;
    }
    const nodeId = hits[0].id;
    const visited = new Set([nodeId]);
    const frontier = [nodeId];
    const results = [];
    for (let d3 = 0; d3 < depth && frontier.length; d3++) {
      const next = [];
      for (const id of frontier) {
        const outgoing =
          dir3 !== 'upstream'
            ? db2.prepare('SELECT target_id, relation FROM edges WHERE source_id = ?').all(id)
            : [];
        const incoming =
          dir3 !== 'downstream'
            ? db2
                .prepare('SELECT source_id as target_id, relation FROM edges WHERE target_id = ?')
                .all(id)
            : [];
        for (const e of [...outgoing, ...incoming]) {
          if (!visited.has(e.target_id)) {
            visited.add(e.target_id);
            next.push(e.target_id);
            const n3 = db2.prepare('SELECT name, label FROM nodes WHERE id = ?').get(e.target_id);
            if (n3) results.push(`  [hop ${d3 + 1}] ${n3.name} (${n3.label}) via ${e.relation}`);
          }
        }
      }
      frontier.length = 0;
      frontier.push(...next);
    }
    ok(
      `Impact of "${hits[0].name}" (${dir3}, depth=${depth}):\n` +
        (results.join('\n') || '  (no dependencies found)'),
    );
  } else if (tool === 'monograph_context') {
    const id = String(input.id || '').slice(0, 4096);
    const hits = ftsSearch(db2, id, 5);
    if (!hits.length) {
      ok(`Node not found: ${id}`);
      return;
    }
    const node = hits[0];
    const outEdges = db2
      .prepare(
        'SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.target_id WHERE e.source_id = ? LIMIT 20',
      )
      .all(node.id);
    const inEdges = db2
      .prepare(
        'SELECT e.relation, n.name FROM edges e JOIN nodes n ON n.id = e.source_id WHERE e.target_id = ? LIMIT 20',
      )
      .all(node.id);
    ok(
      `# ${node.name} (${node.label})\nFile: ${node.filePath || '?'}\n\n**Imports / depends on (${outEdges.length}):**\n${outEdges.map((e) => `  → ${e.name} [${e.relation}]`).join('\n') || '  (none)'}\n\n**Used by / depended on by (${inEdges.length}):**\n${inEdges.map((e) => `  ← ${e.name} [${e.relation}]`).join('\n') || '  (none)'}`,
    );
  } else if (tool === 'monograph_query' || tool === 'monograph_suggest') {
    const q2 = String(input.query || input.task || '').slice(0, 4096);
    const hits2 = ftsSearch(db2, q2, 20);
    ok(
      hits2
        .map((h) => `${h.name} (${h.label}) — ${h.filePath || '?'}:${h.startLine || '?'}`)
        .join('\n') || 'No results',
    );
  } else if (tool === 'monograph_unlinked_refs') {
    const limit = input.limit || 50;
    const rows = db2
      .prepare(
        `SELECT n.name, n.label, n.file_path FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label IN ('Function','Class','Variable','Interface','Method','Module') ORDER BY n.name LIMIT ?`,
      )
      .all(limit);
    if (!rows.length) {
      ok('No unlinked symbols found — all exports appear to be referenced.');
    } else {
      ok(
        `Unlinked Symbols (${rows.length}) — potentially unused exports:\n${'─'.repeat(50)}\n${rows.map((r) => `  ${r.name} (${r.label})\n    ${r.file_path || '?'}`).join('\n\n')}`,
      );
    }
  } else if (tool === 'monograph_reachability') {
    const limit = input.limit || 30;
    const unreachable = db2
      .prepare(
        `SELECT n.name, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as out_deg FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label = 'File' ORDER BY out_deg DESC LIMIT ?`,
      )
      .all(limit);
    const total = db2.prepare("SELECT COUNT(*) as c FROM nodes WHERE label = 'File'").get().c;
    if (!unreachable.length) {
      ok(`All ${total} files are reachable from at least one other file.`);
    } else {
      ok(
        `Unreachable Files (${unreachable.length} of ${total} total):\n${'─'.repeat(50)}\n${unreachable.map((r) => `  ${r.name}${r.out_deg ? ` (imports ${r.out_deg} others)` : ''}\n    ${r.file_path || '?'}`).join('\n\n')}`,
      );
    }
  } else if (tool === 'monograph_boundary_check') {
    const limit = input.limit || 40;
    const rows = db2
      .prepare(
        `SELECT n1.file_path as src, n2.file_path as dst, e.relation, COUNT(*) as cnt FROM edges e JOIN nodes n1 ON n1.id = e.source_id JOIN nodes n2 ON n2.id = e.target_id WHERE n1.file_path IS NOT NULL AND n2.file_path IS NOT NULL AND n1.file_path != n2.file_path GROUP BY n1.file_path, n2.file_path ORDER BY cnt DESC LIMIT ?`,
      )
      .all(limit);
    const suspicious = rows.filter((r) => {
      const s = (r.src || '').toLowerCase(),
        t = (r.dst || '').toLowerCase();
      return (
        (s.includes('test') && !t.includes('test')) ||
        (s.includes('spec') && !t.includes('spec')) ||
        (s.includes('/ui/') && t.includes('/db/')) ||
        (s.includes('/view') && t.includes('/model'))
      );
    });
    if (!suspicious.length) {
      ok(
        `Boundary check: ${rows.length} cross-file edge groups — no obvious violations.\nTop connections:\n${rows
          .slice(0, 10)
          .map((r) => `  ${r.src} → ${r.dst} [${r.cnt}x]`)
          .join('\n')}`,
      );
    } else {
      ok(
        `Boundary Violations (${suspicious.length} suspicious):\n${'─'.repeat(50)}\n${suspicious.map((r) => `  ⚠ ${r.src}\n    → ${r.dst}  [${r.cnt} edges]`).join('\n\n')}`,
      );
    }
  } else if (tool === 'monograph_regression_check' || tool === 'monograph_baseline_compare') {
    const n = countNodes(db2),
      e = countEdges(db2);
    const bPath = path.join(d2, '.monomind', 'monograph-baseline.json');
    if (!fs.existsSync(bPath)) {
      fs.writeFileSync(
        bPath,
        JSON.stringify({ nodes: n, edges: e, savedAt: new Date().toISOString() }),
        'utf-8',
      );
      ok(`Baseline saved (${n} nodes, ${e} edges). Run again to compare.`);
    } else {
      const base = JSON.parse(fs.readFileSync(bPath, 'utf-8'));
      const dn = n - base.nodes,
        de = e - base.edges;
      const sign = (v) => (v > 0 ? `+${v}` : String(v));
      ok(
        `Comparison vs baseline (${base.savedAt || 'unknown'}):\n${'─'.repeat(50)}\n  Nodes: ${base.nodes} → ${n} (${sign(dn)})\n  Edges: ${base.edges} → ${e} (${sign(de)})\n\n${dn === 0 && de === 0 ? '✓ No structural regressions detected.' : '⚠ Graph has changed since baseline.'}`,
      );
    }
  } else if (tool === 'monograph_clone_detect' || tool === 'monograph_similar_files') {
    const limit = input.limit || 20;
    const fileNodes = db2
      .prepare("SELECT id, name, file_path FROM nodes WHERE label = 'File' LIMIT 300")
      .all();
    const deps = {};
    for (const f of fileNodes) {
      deps[f.id] = {
        name: f.name,
        set: new Set(
          db2
            .prepare('SELECT target_id FROM edges WHERE source_id = ?')
            .all(f.id)
            .map((r) => r.target_id),
        ),
      };
    }
    const keys = Object.keys(deps),
      pairs = [];
    for (let i = 0; i < Math.min(keys.length, 150); i++) {
      for (let j = i + 1; j < Math.min(keys.length, 150); j++) {
        const a = deps[keys[i]],
          b = deps[keys[j]];
        if (!a.set.size && !b.set.size) continue;
        const inter = [...a.set].filter((x) => b.set.has(x)).length;
        const union = new Set([...a.set, ...b.set]).size;
        const jac = union ? inter / union : 0;
        if (jac > 0.5) pairs.push({ a: a.name, b: b.name, jac });
      }
    }
    pairs.sort((x, y) => y.jac - x.jac);
    const top = pairs.slice(0, limit);
    if (!top.length) {
      ok('No similar file pairs found (Jaccard threshold: 0.5).');
    } else {
      ok(
        `Similar File Pairs (${top.length}, by import pattern):\n${'─'.repeat(50)}\n${top.map((p) => `  ${(p.jac * 100).toFixed(0)}% similar\n    ${p.a}\n    ${p.b}`).join('\n\n')}`,
      );
    }
  } else if (tool === 'monograph_mirrored_dirs') {
    const fileNodes = db2
      .prepare("SELECT file_path FROM nodes WHERE label = 'File' AND file_path IS NOT NULL")
      .all();
    const dirFiles = {};
    for (const f of fileNodes) {
      const dir = path.dirname(f.file_path),
        base = path.basename(f.file_path);
      if (!dirFiles[dir]) dirFiles[dir] = new Set();
      dirFiles[dir].add(base);
    }
    const dirs = Object.keys(dirFiles),
      pairs = [];
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        const a = dirFiles[dirs[i]],
          b = dirFiles[dirs[j]];
        const inter = [...a].filter((x) => b.has(x)).length;
        const union = new Set([...a, ...b]).size;
        const jac = union ? inter / union : 0;
        if (jac >= 0.5 && inter >= 2) pairs.push({ a: dirs[i], b: dirs[j], overlap: inter, jac });
      }
    }
    pairs.sort((x, y) => y.jac - x.jac);
    if (!pairs.length) {
      ok('No mirrored directory pairs detected (Jaccard ≥ 0.5, min 2 shared files).');
    } else {
      ok(
        `Mirrored Directories (${pairs.length} pairs):\n${'─'.repeat(50)}\n${pairs
          .slice(0, 20)
          .map(
            (p) =>
              `  ${(p.jac * 100).toFixed(0)}% overlap (${p.overlap} shared files)\n    ${p.a}\n    ${p.b}`,
          )
          .join('\n\n')}`,
      );
    }
  } else if (tool === 'monograph_health_score' || tool === 'monograph_vital_signs_snapshot') {
    const n = countNodes(db2),
      e = countEdges(db2);
    const dead = db2
      .prepare(
        "SELECT COUNT(*) as c FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label IN ('Function','Class','Method')",
      )
      .get().c;
    const hubs = db2
      .prepare(
        'SELECT COUNT(*) as c FROM (SELECT source_id FROM edges GROUP BY source_id HAVING COUNT(*) > 20)',
      )
      .get().c;
    const density = n > 1 ? ((2 * e) / (n * (n - 1))).toFixed(4) : '0';
    const deadRatio = n ? ((dead / n) * 100).toFixed(1) : '0';
    const score = Math.max(
      0,
      Math.min(100, 100 - Math.min(30, parseFloat(deadRatio) * 0.5) - Math.min(20, hubs * 2)),
    ).toFixed(0);
    const status =
      parseInt(score, 10) >= 70 ? '✓ OK' : parseInt(score, 10) >= 40 ? '⚠ WARNING' : '✗ CRITICAL';
    ok(
      `Vital Signs — ${new Date().toISOString()}\n${'─'.repeat(50)}\n  Health Score:  ${score}/100  ${status}\n  Nodes:         ${n}\n  Edges:         ${e}\n  Density:       ${density}\n  Dead symbols:  ${dead} (${deadRatio}%)\n  Hub nodes:     ${hubs} nodes with >20 edges`,
    );
  } else if (tool === 'monograph_health_trend') {
    const bPath = path.join(d2, '.monomind', 'monograph-baseline.json');
    if (!fs.existsSync(bPath)) {
      ok('No trend data yet. Run "Health Score" or "Regression Check" first to save a baseline.');
    } else {
      const base = JSON.parse(fs.readFileSync(bPath, 'utf-8'));
      const n = countNodes(db2),
        e = countEdges(db2);
      const dn = n - base.nodes,
        de = e - base.edges;
      const sign = (v) => (v > 0 ? `+${v}` : String(v));
      ok(
        `Health Trend (vs ${base.savedAt || 'unknown'}):\n${'─'.repeat(50)}\n  Nodes: ${base.nodes} → ${n} (${sign(dn)})\n  Edges: ${base.edges} → ${e} (${sign(de)})\n  Trend: ${dn === 0 && de === 0 ? 'stable' : dn > 0 ? 'growing' : 'shrinking'}`,
      );
    }
  } else if (tool === 'monograph_hotspots') {
    const limit = input.limit || 20;
    const rows = db2
      .prepare(
        `SELECT n.name, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id OR target_id = n.id) as degree, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as fan_out, (SELECT COUNT(*) FROM edges WHERE target_id = n.id) as fan_in FROM nodes n WHERE n.label = 'File' ORDER BY degree DESC LIMIT ?`,
      )
      .all(limit);
    if (!rows.length) {
      ok('No file hotspots found.');
    } else {
      ok(
        `Hotspot Files (top ${rows.length} by degree):\n${'─'.repeat(50)}\n${rows.map((r, i) => `  ${i + 1}. ${r.name}  [degree ${r.degree}: ↑${r.fan_in} in, ↓${r.fan_out} out]\n     ${r.file_path || '?'}`).join('\n')}`,
      );
    }
  } else {
    return false;
  }
  return true;
}

export { handleMcpToolsPart1 };
