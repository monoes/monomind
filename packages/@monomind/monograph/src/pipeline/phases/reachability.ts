import type Database from 'better-sqlite3';

export type ReachabilityRole = 'runtime' | 'test' | 'support' | 'unreachable';

/**
 * Classify every File node's reachability role.
 *
 * Entry point detection:
 * - Test entry points: files matching test patterns (*.test.*, *.spec.*, __tests__/*)
 * - Runtime entry points: files with no incoming IMPORTS edges (potential roots)
 * - Support files: *.config.*, scripts/*, tools/* etc.
 *
 * BFS propagation (forward — follows what files import):
 * - From test entry points: mark reachable files as 'test'
 * - From runtime entry points: mark reachable files as 'runtime'
 * - Files reachable from both: 'runtime' wins over 'test'
 * - Nodes reachable from neither: marked 'unreachable'
 * - Config/support files (*.config.*, scripts/*): marked 'support'
 */
export function classifyReachability(
  db: Database.Database,
  _projectDir: string,
): { runtime: number; test: number; support: number; unreachable: number } {
  const TEST_PATTERNS = [
    /\.test\.[tj]sx?$/,
    /\.spec\.[tj]sx?$/,
    /__tests__\//,
    /\/test\//,
    /\/tests\//,
  ];
  const SUPPORT_PATTERNS = [
    /\.config\.[tj]sx?$/,
    /\/scripts\//,
    /\/tools\//,
    /jest\.config/,
    /vitest\.config/,
    /webpack\.config/,
    /vite\.config/,
  ];

  const allFileNodes = db.prepare(
    `SELECT id, file_path, properties FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`,
  ).all() as { id: string; file_path: string; properties: string | null }[];

  const roleMap = new Map<string, ReachabilityRole>();
  const testEntryIds = new Set<string>();
  const runtimeEntryIds = new Set<string>();

  // Initial classification by path pattern
  for (const node of allFileNodes) {
    const fp = node.file_path;
    if (TEST_PATTERNS.some(p => p.test(fp))) {
      testEntryIds.add(node.id);
      roleMap.set(node.id, 'test');
    } else if (SUPPORT_PATTERNS.some(p => p.test(fp))) {
      roleMap.set(node.id, 'support');
    }
  }

  // Files with no incoming IMPORTS edges are potential runtime roots
  const noIncoming = db.prepare(`
    SELECT n.id FROM nodes n
    WHERE n.label = 'File'
    AND NOT EXISTS (
      SELECT 1 FROM edges e WHERE e.target_id = n.id AND e.relation = 'IMPORTS'
    )
  `).all() as { id: string }[];

  for (const { id } of noIncoming) {
    if (!roleMap.has(id)) {
      runtimeEntryIds.add(id);
      roleMap.set(id, 'runtime');
    }
  }

  // ── BFS from entry points — forward direction (walk what files import) ───────
  const bfs = (startIds: Set<string>, role: ReachabilityRole) => {
    const queue = Array.from(startIds);
    const visited = new Set(startIds);
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      // Follow forward edges: find files that this file imports
      const imported = db.prepare(
        `SELECT DISTINCT target_id FROM edges WHERE source_id = ? AND relation IN ('IMPORTS', 'RE_EXPORTS')`,
      ).all(nodeId) as { target_id: string }[];
      for (const { target_id } of imported) {
        if (!visited.has(target_id)) {
          visited.add(target_id);
          // Set role only if not already set to a higher-priority role
          // Priority: runtime > test > support > unreachable
          const existing = roleMap.get(target_id);
          if (!existing || existing === 'unreachable' || (role === 'runtime' && existing === 'test')) {
            roleMap.set(target_id, role);
          }
          queue.push(target_id);
        }
      }
    }
  };

  // Test BFS first, then runtime (runtime wins on overlap)
  bfs(testEntryIds, 'test');
  bfs(runtimeEntryIds, 'runtime');

  // ── Persist roles and count ───────────────────────────────────────────────────
  let runtime = 0, test = 0, support = 0, unreachable = 0;
  for (const node of allFileNodes) {
    const role = roleMap.get(node.id) ?? 'unreachable';
    let props: Record<string, unknown> = {};
    try {
      if (node.properties) props = JSON.parse(node.properties);
    } catch { /* ignore parse errors */ }
    props.reachabilityRole = role;
    db.prepare(`UPDATE nodes SET properties = ? WHERE id = ?`)
      .run(JSON.stringify(props), node.id);
    if (role === 'runtime') runtime++;
    else if (role === 'test') test++;
    else if (role === 'support') support++;
    else unreachable++;
  }

  return { runtime, test, support, unreachable };
}

/**
 * Get File nodes filtered by reachability role.
 */
export function getNodesByReachabilityRole(
  db: Database.Database,
  role: ReachabilityRole,
  limit = 100,
): Array<{ id: string; name: string; filePath: string | null }> {
  const rows = db.prepare(`
    SELECT id, name, file_path
    FROM nodes
    WHERE label = 'File'
    AND json_extract(properties, '$.reachabilityRole') = ?
    LIMIT ?
  `).all(role, limit) as { id: string; name: string; file_path: string | null }[];
  return rows.map(r => ({ id: r.id, name: r.name, filePath: r.file_path }));
}
