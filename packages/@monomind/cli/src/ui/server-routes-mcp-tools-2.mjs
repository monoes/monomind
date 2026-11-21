// Tool-name dispatch for POST /api/mcp/call, part 2 of 2 (split for file size).
// Registered, in order, by handleMcpCallRoutes in server-routes-mcp-call.mjs.
async function handleMcpToolsPart2(mcpCtx) {
  const { tool, input, db2, ok, d2, countNodes, countEdges } = mcpCtx;
  if (tool === 'monograph_maintainability') {
    const limit = input.limit || 25;
    const rows = db2
      .prepare(
        `SELECT n.name, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as fan_out, (SELECT COUNT(*) FROM edges WHERE target_id = n.id) as fan_in FROM nodes n WHERE n.label = 'File' ORDER BY fan_out DESC LIMIT ?`,
      )
      .all(limit);
    if (!rows.length) {
      ok('No file data for maintainability analysis.');
    } else {
      const maxOut = Math.max(...rows.map((r) => r.fan_out), 1);
      const lines = rows.map((r) => {
        const mi = Math.max(0, 100 - (r.fan_out / maxOut) * 60 - (r.fan_in > 10 ? 20 : 0)).toFixed(
          0,
        );
        return `  ${parseInt(mi, 10) >= 70 ? '✓' : parseInt(mi, 10) >= 40 ? '⚠' : '✗'} MI:${mi.padStart(3)}  out:${String(r.fan_out).padStart(4)}  in:${String(r.fan_in).padStart(4)}  ${r.name}`;
      });
      ok(
        `Maintainability Index (estimated from fan-out/fan-in):\n${'─'.repeat(60)}\n${lines.join('\n')}`,
      );
    }
  } else if (tool === 'monograph_complexity' || tool === 'monograph_crap_score') {
    const limit = input.limit || 25;
    const rows = db2
      .prepare(
        `SELECT n.name, n.label, n.file_path, (SELECT COUNT(*) FROM edges WHERE source_id = n.id) as out_deg FROM nodes n WHERE n.label IN ('Function','Method','Class') ORDER BY out_deg DESC LIMIT ?`,
      )
      .all(limit);
    if (!rows.length) {
      ok('No function/method nodes found. Build the graph first.');
    } else {
      const isCrap = tool === 'monograph_crap_score';
      const header = isCrap
        ? 'CRAP Score proxy (degree² — lower is better)'
        : 'Complexity by Out-Degree';
      ok(
        `${header}:\n${'─'.repeat(50)}\n${rows.map((r) => `  ${r.name} (${r.label})  ${isCrap ? 'CRAP' : 'complexity'}: ${isCrap ? r.out_deg ** 2 : r.out_deg}\n    ${r.file_path || '?'}`).join('\n')}`,
      );
    }
  } else if (tool === 'monograph_risk_profile') {
    const n = countNodes(db2),
      e = countEdges(db2);
    const dead = db2
      .prepare(
        "SELECT COUNT(*) as c FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label IN ('Function','Class','Method')",
      )
      .get().c;
    const hubs = db2
      .prepare(
        'SELECT COUNT(*) as c FROM (SELECT source_id FROM edges GROUP BY source_id HAVING COUNT(*) > 15)',
      )
      .get().c;
    const files = db2.prepare("SELECT COUNT(*) as c FROM nodes WHERE label = 'File'").get().c;
    const orphans = db2
      .prepare(
        "SELECT COUNT(*) as c FROM nodes n LEFT JOIN edges e ON e.target_id = n.id WHERE e.target_id IS NULL AND n.label = 'File'",
      )
      .get().c;
    const risks = [];
    if (dead > 10) risks.push(`  HIGH   Dead symbols: ${dead} unreferenced nodes`);
    if (hubs > 3) risks.push(`  MEDIUM Hub nodes: ${hubs} nodes with >15 dependencies`);
    if (orphans > files * 0.3)
      risks.push(`  MEDIUM Orphan files: ${orphans} of ${files} files unreachable`);
    if (n > 0 && e / n < 0.5) risks.push(`  LOW    Sparse graph: avg degree ${(e / n).toFixed(2)}`);
    ok(
      `Risk Profile — ${new Date().toISOString().split('T')[0]}\n${'─'.repeat(50)}\n${risks.length ? risks.join('\n') : '  No significant risks detected.'}\n\nSummary: ${n} nodes · ${e} edges · ${files} files`,
    );
  } else if (tool === 'monograph_author_analytics') {
    // Clamp to a safe integer — this value is interpolated into a shell command below.
    const limit = Math.min(Math.max(parseInt(input.limit, 10) || 20, 1), 100);
    const { execSync: execS } = await import('node:child_process');
    try {
      const log = execS(
        `git log --format="%ae" --no-merges -- . 2>/dev/null | sort | uniq -c | sort -rn | head -${limit}`,
        { cwd: d2, encoding: 'utf-8', timeout: 5000 },
      );
      if (!log.trim()) {
        ok('No git history found for this project directory.');
      } else {
        ok(
          `Author Analytics (by commit count):\n${'─'.repeat(50)}\n${log
            .trim()
            .split('\n')
            .map((l) => {
              const m = l.trim().match(/^(\d+)\s+(.+)$/);
              return m ? `  ${m[2].padEnd(45)} ${m[1]} commits` : l;
            })
            .join('\n')}`,
        );
      }
    } catch {
      ok('Author analytics requires git. Ensure this directory is a git repository.');
    }
  } else if (tool === 'monograph_circular_deps') {
    // Find import cycles using iterative DFS
    const limit = Math.min(parseInt(input.limit || '10', 10) || 10, 20);
    const importEdges = db2
      .prepare(
        `SELECT source_id, target_id FROM edges WHERE relation IN ('IMPORTS','REQUIRES','USES','DEPENDS_ON') LIMIT 50000`,
      )
      .all();
    const adj = {};
    for (const e of importEdges) {
      (adj[e.source_id] = adj[e.source_id] || []).push(e.target_id);
    }
    const cycles = [];
    const visited = new Set(),
      inStack = new Set();
    function dfs(node, path) {
      if (cycles.length >= limit) return;
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) cycles.push(path.slice(cycleStart).concat(node));
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);
      path.push(node);
      for (const nb of adj[node] || []) dfs(nb, path);
      path.pop();
      inStack.delete(node);
    }
    for (const node of Object.keys(adj).slice(0, 2000)) dfs(node, []);
    const getName = (id) => id.split('/').slice(-2).join('/');
    if (!cycles.length)
      ok(
        `No circular dependencies found among ${Object.keys(adj).length} nodes with import edges.`,
      );
    else
      ok(
        `Circular Dependencies (${cycles.length} found):\n${'─'.repeat(50)}\n${cycles
          .slice(0, limit)
          .map((c, i) => `  ${i + 1}. ${c.map(getName).join(' → ')}`)
          .join('\n')}`,
      );
  } else if (tool === 'monograph_largest_files') {
    const limit2 = Math.min(parseInt(input.limit || '25', 10) || 25, 50);
    const rows = db2
      .prepare(
        `SELECT file_path, MAX(end_line) as lines, COUNT(*) as symbols FROM nodes WHERE file_path IS NOT NULL AND end_line IS NOT NULL AND end_line > 0 GROUP BY file_path ORDER BY lines DESC LIMIT ${limit2}`,
      )
      .all();
    if (!rows.length)
      ok('No line-count data available. Ensure the index was built with source parsing enabled.');
    else
      ok(
        `Largest Files by Line Count:\n${'─'.repeat(50)}\n${rows.map((r, i) => `  ${String(i + 1).padStart(2)}. ${r.lines.toString().padStart(5)} lines  ${r.symbols} symbols  ${r.file_path.split('/').slice(-2).join('/')}`).join('\n')}`,
      );
  } else if (tool === 'monograph_coupling_balance') {
    // Fan-out (what this file uses) vs Fan-in (what uses this file)
    const limit3 = Math.min(parseInt(input.limit || '20', 10) || 20, 40);
    const fanOut = db2
      .prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`)
      .all();
    const fanIn = db2
      .prepare(`SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id`)
      .all();
    const outMap = {},
      inMap = {};
    for (const r of fanOut) outMap[r.source_id] = r.c;
    for (const r of fanIn) inMap[r.target_id] = r.c;
    const allIds = new Set([...Object.keys(outMap), ...Object.keys(inMap)]);
    const nodes3 = db2
      .prepare(`SELECT id, name, file_path FROM nodes WHERE label='File' LIMIT 10000`)
      .all();
    const fileSet = new Set(nodes3.map((n) => n.id));
    const entries = [...allIds]
      .filter((id) => fileSet.has(id))
      .map((id) => {
        const o = outMap[id] || 0,
          i = inMap[id] || 0;
        const n = nodes3.find((x) => x.id === id);
        return {
          name: n?.name || id.split('/').pop(),
          path: n?.file_path || '',
          out: o,
          inn: i,
          ratio: i > 0 ? (o / i).toFixed(1) : '∞',
        };
      })
      .filter((x) => x.out > 0 || x.inn > 0)
      .sort((a, b) => b.out + b.inn - (a.out + a.inn))
      .slice(0, limit3);
    ok(
      `Coupling Balance (Fan-out vs Fan-in, top ${limit3} by activity):\n${'─'.repeat(60)}\n  ${'File'.padEnd(35)} Out  In  Ratio\n${'─'.repeat(60)}\n${entries.map((e) => `  ${e.name.slice(0, 35).padEnd(35)} ${String(e.out).padStart(3)}  ${String(e.inn).padStart(2)}  ${e.ratio}`).join('\n')}`,
    );
  } else if (tool === 'monograph_dead_exports') {
    // Exported symbols with zero inbound edges
    const exported = db2
      .prepare(`SELECT id, name, label, file_path FROM nodes WHERE is_exported=1 LIMIT 10000`)
      .all();
    const inbound = new Set(
      db2
        .prepare(`SELECT DISTINCT target_id FROM edges`)
        .all()
        .map((r) => r.target_id),
    );
    const dead2 = exported.filter((n) => !inbound.has(n.id));
    if (!dead2.length)
      ok('No dead exports found — all exported symbols have at least one inbound reference.');
    else
      ok(
        `Dead Exports — exported but never imported (${dead2.length} of ${exported.length} exported symbols):\n${'─'.repeat(50)}\n${dead2
          .slice(0, 30)
          .map(
            (n) =>
              `  ${n.label.padEnd(12)} ${n.name}  →  ${(n.file_path || '').split('/').slice(-2).join('/')}`,
          )
          .join('\n')}`,
      );
  } else if (tool === 'monograph_language_breakdown') {
    const rows2 = db2
      .prepare(
        `SELECT language, COUNT(*) as c FROM nodes WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY c DESC`,
      )
      .all();
    if (!rows2.length) ok('No language metadata available in this graph index.');
    else {
      const total2 = rows2.reduce((s, r) => s + r.c, 0);
      const maxC = rows2[0].c;
      ok(
        `Language Breakdown:\n${'─'.repeat(50)}\n${rows2
          .map((r) => {
            const bar = '█'.repeat(Math.round((r.c / maxC) * 20));
            const pct = ((r.c / total2) * 100).toFixed(1);
            return `  ${r.language.padEnd(15)} ${bar.padEnd(20)} ${String(r.c).padStart(6)} (${pct}%)`;
          })
          .join('\n')}\n\n  Total nodes: ${total2}`,
      );
    }
  } else if (tool === 'monograph_instability') {
    // Robert Martin's Instability = Ce / (Ca + Ce)
    // Ca = afferent coupling (in-degree), Ce = efferent coupling (out-degree)
    const _limit4 = Math.min(parseInt(input.limit || '25', 10) || 25, 50);
    const outRows = db2
      .prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`)
      .all();
    const inRows = db2
      .prepare(`SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id`)
      .all();
    const Ce = {},
      Ca = {};
    for (const r of outRows) Ce[r.source_id] = r.c;
    for (const r of inRows) Ca[r.target_id] = r.c;
    const fileNodes = db2
      .prepare(`SELECT id, name, file_path FROM nodes WHERE label='File' LIMIT 10000`)
      .all();
    const entries4 = fileNodes
      .map((n) => {
        const ca = Ca[n.id] || 0,
          ce = Ce[n.id] || 0;
        const total = ca + ce;
        const inst = total > 0 ? ce / total : 0;
        return { name: n.name || n.id.split('/').pop(), ca, ce, inst };
      })
      .filter((x) => x.ca + x.ce > 0)
      .sort((a, b) => b.inst - a.inst);
    const risky = entries4.filter((x) => x.inst > 0.7 && x.ca > 3);
    const stable = entries4.filter((x) => x.inst < 0.2 && x.ce > 3);
    ok(
      `Instability Index (Ce÷(Ca+Ce), 0=stable 1=unstable):\n${'─'.repeat(60)}\n\n  ⚠  High instability + high dependents (blast radius risk):\n${
        risky
          .slice(0, 10)
          .map(
            (x) =>
              `     ${x.name.slice(0, 40).padEnd(40)} I=${x.inst.toFixed(2)}  Ca=${x.ca}  Ce=${x.ce}`,
          )
          .join('\n') || '  none'
      }\n\n  ✓  Stable (low instability, many dependents on them):\n${
        stable
          .slice(0, 8)
          .map(
            (x) =>
              `     ${x.name.slice(0, 40).padEnd(40)} I=${x.inst.toFixed(2)}  Ca=${x.ca}  Ce=${x.ce}`,
          )
          .join('\n') || '  none'
      }\n\n  Total files analyzed: ${entries4.length}`,
    );
  } else if (tool === 'monograph_churn_hotspots') {
    // Combines git churn frequency with structural complexity (out-degree)
    const limit5 = Math.min(parseInt(input.limit || '15', 10) || 15, 30);
    const { execSync: execS2 } = await import('node:child_process');
    const churnMap = {};
    try {
      // Whitelist the --since value — it is interpolated into a shell command below.
      const sinceRaw = String(input.since || '');
      const since = /^\d+ (day|week|month|year)s? ago$/.test(sinceRaw) ? sinceRaw : '6 months ago';
      const log2 = execS2(
        `git log --since="${since}" --name-only --format="" -- . 2>/dev/null | grep -v '^$' | sort | uniq -c | sort -rn | head -200`,
        { cwd: d2, encoding: 'utf-8', timeout: 8000 },
      );
      for (const line of log2.trim().split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(.+)$/);
        if (m) churnMap[m[2]] = parseInt(m[1], 10);
      }
    } catch {}
    if (!Object.keys(churnMap).length) {
      ok('No git history found — churn analysis requires a git repository.');
    } else {
      const outDeg = db2
        .prepare(`SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id`)
        .all();
      const degMap2 = {};
      for (const r of outDeg) degMap2[r.source_id] = r.c;
      const fileNodes2 = db2
        .prepare(`SELECT id, name, file_path FROM nodes WHERE label='File' LIMIT 10000`)
        .all();
      const maxChurn = Math.max(...Object.values(churnMap), 1);
      const maxDeg2 = Math.max(...Object.values(degMap2), 1);
      const scored = fileNodes2
        .map((n) => {
          const fp = n.file_path || '';
          const churn =
            churnMap[fp] || Object.entries(churnMap).find(([k]) => fp.endsWith(k))?.[1] || 0;
          const deg = degMap2[n.id] || 0;
          const score2 = (churn / maxChurn) * 0.6 + (deg / maxDeg2) * 0.4;
          return { name: n.name || fp.split('/').pop(), fp, churn, deg, score: score2 };
        })
        .filter((x) => x.churn > 0 || x.deg > 5)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit5);
      if (!scored.length) ok('No files matched both churn and complexity criteria.');
      else
        ok(
          `Churn × Complexity Hotspots (60% churn weight + 40% coupling weight):\n${'─'.repeat(60)}\n  ${'File'.padEnd(38)} Churn  Deps  Score\n${'─'.repeat(60)}\n${scored.map((x) => `  ${x.name.slice(0, 38).padEnd(38)} ${String(x.churn).padStart(5)}  ${String(x.deg).padStart(4)}  ${(x.score * 100).toFixed(0)}%`).join('\n')}\n\n  Analyzed: ${scored.length} hotspot candidates from last ${input.since || '6 months'}`,
        );
    }
  } else {
    return false;
  }
  return true;
}

export { handleMcpToolsPart2 };
