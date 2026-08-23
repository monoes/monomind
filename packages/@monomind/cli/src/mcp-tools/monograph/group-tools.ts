import { join } from 'node:path';
import type { MCPTool } from '../types.js';
import { getProjectCwd } from '../types.js';
import { getDbPath, text } from './shared.js';

// ── monograph_community ───────────────────────────────────────────────────────

export const monographCommunityTool: MCPTool = {
  name: 'monograph_community',
  description: 'Get all nodes belonging to a community (by numeric community ID).',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Community ID' },
    },
    required: ['id'],
  },
  handler: async (input) => {
    // Validate community ID — must be a finite integer. parseInt(NaN) or a float
    // would silently become 0 in SQLite (NaN → NULL → 0 coercion), which would
    // return all nodes in community 0 instead of an error.
    const rawId = typeof input.id === 'number' ? input.id : parseInt(String(input.id), 10);
    if (!Number.isFinite(rawId) || rawId !== Math.floor(rawId)) {
      return text(`Invalid community ID: ${input.id} (must be an integer)`);
    }
    const communityId = rawId;
    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const rows = db
        .prepare('SELECT id, label, name, file_path, start_line FROM nodes WHERE community_id = ?')
        .all(communityId) as any[];
      if (rows.length === 0) return text(`No nodes in community ${communityId}`);
      return text(
        rows
          .map((r) => {
            const loc = r.file_path
              ? r.start_line != null
                ? `${r.file_path}:${r.start_line}`
                : r.file_path
              : '';
            return `[${r.label}] ${r.name}  ${loc}`;
          })
          .join('\n'),
      );
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_surprises ───────────────────────────────────────────────────────

export const monographSurprisesTool: MCPTool = {
  name: 'monograph_surprises',
  description: 'Show unexpected cross-community or low-confidence edges ranked by surprise score.',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Max results (default 20)' } },
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      // Cap limit: passed directly to the SQL LIMIT clause.
      const MAX_SURPRISES_LIMIT = 1_000;
      const rawSurprisesLimit = (input.limit as number | undefined) ?? 20;
      const limit =
        Number.isFinite(rawSurprisesLimit) && rawSurprisesLimit > 0
          ? Math.min(Math.floor(rawSurprisesLimit), MAX_SURPRISES_LIMIT)
          : 20;
      const rows = db
        .prepare(`
        SELECT e.confidence, e.confidence_score, e.relation,
               n1.name as src_name, n1.file_path as src_file, n1.start_line as src_line,
               n2.name as tgt_name, n2.file_path as tgt_file, n2.start_line as tgt_line
        FROM edges e
        JOIN nodes n1 ON n1.id = e.source_id
        JOIN nodes n2 ON n2.id = e.target_id
        WHERE e.confidence != 'EXTRACTED'
        ORDER BY e.confidence_score ASC LIMIT ?
      `)
        .all(limit) as any[];
      if (rows.length === 0) return text('No surprising connections found.');
      return text(
        rows
          .map((r) => {
            const srcLoc = r.src_file
              ? r.src_line != null
                ? `${r.src_file}:${r.src_line}`
                : r.src_file
              : '';
            const tgtLoc = r.tgt_file
              ? r.tgt_line != null
                ? `${r.tgt_file}:${r.tgt_line}`
                : r.tgt_file
              : '';
            const locHint = srcLoc || tgtLoc ? `  [${srcLoc}${tgtLoc ? ` → ${tgtLoc}` : ''}]` : '';
            return `[${r.confidence}] ${r.src_name} --${r.relation}--> ${r.tgt_name} (score: ${r.confidence_score})${locHint}`;
          })
          .join('\n'),
      );
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_group_list ──────────────────────────────────────────────────────

export const monographGroupListTool: MCPTool = {
  name: 'monograph_group_list',
  description:
    'List repos in a group.yaml with index metadata (node count and indexed_at timestamp). Useful for checking which repos have been indexed.',
  inputSchema: {
    type: 'object',
    properties: {
      configPath: {
        type: 'string',
        description: 'Path to group.yaml (defaults to group.yaml in project cwd)',
      },
    },
  },
  handler: async (input) => {
    const { getGroupList } = await import('@monoes/monograph');
    const configPath =
      (input.configPath as string | undefined) ?? join(getProjectCwd(), 'group.yaml');
    const result = await getGroupList(configPath);
    const firstGroup = result.groups?.[0];
    const allRepos = result.groups?.flatMap((g: any) => g.repos ?? []) ?? [];
    if (!allRepos.length) {
      return text(
        `Group: ${firstGroup?.name ?? 'unknown'}\nNo repos configured. Check ${configPath}`,
      );
    }
    const lines = [`Group: ${firstGroup?.name ?? 'unknown'}  (${allRepos.length} repos)`];
    for (const r of allRepos) {
      const indexed = r.indexedAt ? r.indexedAt.slice(0, 10) : 'never';
      lines.push(`  ${r.name}  nodes=${r.nodeCount}  indexed=${indexed}  ${r.path}`);
    }
    return text(lines.join('\n'));
  },
};

// ── monograph_group_query ─────────────────────────────────────────────────────

export const monographGroupQueryTool: MCPTool = {
  name: 'monograph_group_query',
  description:
    'BM25 keyword search merged across all repos in a group.yaml using Reciprocal Rank Fusion (RRF). Returns results tagged with which repo they came from.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search terms' },
      configPath: {
        type: 'string',
        description: 'Path to group.yaml (defaults to group.yaml in project cwd)',
      },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
    required: ['query'],
  },
  handler: async (input) => {
    const { runGroupQuery } = await import('@monoes/monograph');
    const configPath =
      (input.configPath as string | undefined) ?? join(getProjectCwd(), 'group.yaml');
    // Cap query and limit forwarded to runGroupQuery.
    const MAX_GROUP_QUERY_LEN = 16 * 1024;
    const MAX_GROUP_LIMIT = 1_000;
    const rawGroupQuery = input.query as string;
    const groupQuery =
      typeof rawGroupQuery === 'string' && rawGroupQuery.length > MAX_GROUP_QUERY_LEN
        ? rawGroupQuery.slice(0, MAX_GROUP_QUERY_LEN)
        : rawGroupQuery;
    const rawGroupLimit = input.limit as number | undefined;
    const groupLimit =
      Number.isFinite(rawGroupLimit) && (rawGroupLimit ?? 0) > 0
        ? Math.min(Math.floor(rawGroupLimit!), MAX_GROUP_LIMIT)
        : rawGroupLimit;
    const results = await runGroupQuery(configPath, groupQuery, groupLimit);
    if (results.length === 0) return text('No results found.');
    const lines = results.map(
      (r) =>
        `[${r.label}] ${r.name}  ${r.filePath ?? ''}  repo:${r.repo}  (score: ${r.score.toFixed(4)})`,
    );
    return text(lines.join('\n'));
  },
};

// ── monograph_group_sync ──────────────────────────────────────────────────────

export const monographGroupSyncTool: MCPTool = {
  name: 'monograph_group_sync',
  description:
    'Scan all repos in a group.yaml for Route nodes, detect shared HTTP contracts across repos, and persist the Contract Registry to disk.',
  inputSchema: {
    type: 'object',
    properties: {
      configPath: {
        type: 'string',
        description: 'Path to group.yaml (defaults to group.yaml in project cwd)',
      },
    },
  },
  handler: async (input) => {
    const { runGroupSync } = await import('@monoes/monograph');
    const configPath =
      (input.configPath as string | undefined) ?? join(getProjectCwd(), 'group.yaml');
    try {
      const result = await runGroupSync(configPath);
      return text(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return text(`Group sync failed: ${msg}`);
    }
  },
};

// ── monograph_group_contracts ─────────────────────────────────────────────────

export const monographGroupContractsTool: MCPTool = {
  name: 'monograph_group_contracts',
  description:
    'List public API contracts (exported symbols, interfaces, and types) for all groups defined in group.yaml.',
  inputSchema: {
    type: 'object',
    properties: {
      configPath: {
        type: 'string',
        description: 'Path to group.yaml (defaults to group.yaml in project cwd)',
      },
    },
  },
  handler: async (input) => {
    const { getGroupContracts } = await import('../monograph-compat.js');
    const configPath =
      (input.configPath as string | undefined) ?? join(getProjectCwd(), 'group.yaml');
    const contracts = await getGroupContracts(configPath);
    if (contracts.length === 0)
      return text(`No contracts found. Ensure groups are defined in ${configPath}.`);
    const lines = contracts.map((c) => `[${c.groupName}] ${c.symbol} — ${c.filePath}:${c.line}`);
    return text(lines.join('\n'));
  },
};

// ── monograph_group_status ────────────────────────────────────────────────────

export const monographGroupStatusTool: MCPTool = {
  name: 'monograph_group_status',
  description:
    'Show health status for all groups: whether each group is indexed, has contracts, and was recently synced.',
  inputSchema: {
    type: 'object',
    properties: {
      configPath: {
        type: 'string',
        description: 'Path to group.yaml (defaults to group.yaml in project cwd)',
      },
    },
  },
  handler: async (input) => {
    const { getGroupStatus } = await import('../monograph-compat.js');
    const configPath =
      (input.configPath as string | undefined) ?? join(getProjectCwd(), 'group.yaml');
    const status = await getGroupStatus(configPath);
    const lines = [
      `Groups: ${status.totalGroups} (${status.indexedGroups} indexed, ${status.stalledGroups} stalled)`,
    ];
    for (const g of status.groups) {
      const icon = g.indexed ? (g.stale ? '⚠️' : '✅') : '❌';
      lines.push(
        `${icon} ${g.name} — ${g.contractCount} contracts${g.lastSync ? ` (synced ${g.lastSync.slice(0, 10)})` : ''}`,
      );
    }
    return text(lines.join('\n'));
  },
};

// ── monograph_list_repos ──────────────────────────────────────────────────────

export const monographListReposTool: MCPTool = {
  name: 'monograph_list_repos',
  description:
    'List all repositories tracked in the global monograph registry (~/.monograph/registry.json).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input) => {
    const { listRepos } = await import('@monoes/monograph');
    const repos = listRepos();
    if (repos.length === 0)
      return text('No repositories registered. Run monograph build in a repo to register it.');
    const lines = repos.map(
      (r) =>
        `${r.name} — ${r.path}${r.lastIndexed ? ` (indexed ${r.lastIndexed.slice(0, 10)})` : ''}${r.nodeCount != null ? ` [${r.nodeCount} nodes, ${r.edgeCount ?? 0} edges]` : ''}`,
    );
    return text(lines.join('\n'));
  },
};
