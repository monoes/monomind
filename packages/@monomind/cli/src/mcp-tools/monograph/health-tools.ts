import type { MCPTool } from '../types.js';
import { getProjectCwd } from '../types.js';
import { getDbPath, _isValidDb, text, computeCommitsBehind, triggerBackgroundBuildIfNeeded, STALENESS_THRESHOLD } from './shared.js';

// ── monograph_stats ─────────────────────────────────────────────────────────

export const monographStatsTool: MCPTool = {
  name: 'monograph_stats',
  description: 'Show node/edge/community counts and index freshness.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const dbPath = getDbPath();
    if (!_isValidDb(dbPath)) return text('Monograph index not built yet. Run monograph_build first.');
    const { openDb, closeDb, countNodes, countEdges } = await import('@monoes/monograph');
    const db = openDb(dbPath);
    try {
      const nodes = countNodes(db);
      const edges = countEdges(db);
      const meta = db.prepare('SELECT key, value FROM index_meta').all() as { key: string; value: string }[];
      const metaStr = meta.map(m => `  ${m.key}: ${m.value}`).join('\n');
      return text(`Monograph index stats:\n  nodes: ${nodes}\n  edges: ${edges}\n${metaStr}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_health ────────────────────────────────────────────────────────

export const monographHealthTool: MCPTool = {
  name: 'monograph_health',
  description: 'Check index staleness: compares last indexed git commit vs current HEAD.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { execSync } = await import('child_process');
    const db = openDb(getDbPath());
    try {
      // The orchestrator writes the key as 'last_commit_hash' (orchestrator.ts:68).
      // Fall back to legacy 'lastCommit' for indexes built with older versions.
      const meta = (
        db.prepare("SELECT value FROM index_meta WHERE key = 'last_commit_hash'").get() as { value: string } | undefined
      ) ?? (
        db.prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get() as { value: string } | undefined
      );
      const lastCommit = meta?.value ?? null;
      if (!lastCommit) {
        // last_commit_hash can be missing even when the index is populated
        // (e.g. git rev-parse failed during build). Check actual data before
        // claiming "never built".
        const nodeCount = (db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as { c: number }).c;
        if (nodeCount > 0) {
          const indexedAt = (db.prepare("SELECT value FROM index_meta WHERE key = 'indexed_at'").get() as { value: string } | undefined)?.value;
          return text(
            `Index is built (${nodeCount} nodes${indexedAt ? `, indexed at ${indexedAt}` : ''}) but no commit hash was recorded — staleness tracking unavailable.\n` +
            'Run monograph_build to fix commit tracking.'
          );
        }
        return text('Index has never been built. Run monograph_build first.');
      }
      if (!/^[0-9a-f]{7,40}$/i.test(lastCommit)) {
        return text('Index metadata is corrupt: invalid commit SHA. Run monograph_build to re-index.');
      }

      let commitsBehind = 0;
      try {
        const out = execSync(`git rev-list --count ${lastCommit}..HEAD`, {
          cwd: getProjectCwd(), encoding: 'utf-8'
        }).trim();
        commitsBehind = parseInt(out, 10);
      } catch { return text('Cannot check staleness: git error'); }

      const status = commitsBehind === 0 ? 'FRESH' : `STALE (${commitsBehind} commits behind)`;
      return text(`Index status: ${status}\nLast indexed commit: ${lastCommit}`);
    } finally { closeDb(db); }
  },
};

// ── monograph_staleness ─────────────────────────────────────────────────────

export const monographStalenessTool: MCPTool = {
  name: 'monograph_staleness',
  description: 'Git staleness detection: compares the commit hash at last index build against current HEAD. When the index is more than 3 commits behind HEAD it automatically triggers a background rebuild. Returns { commitsBehind, status, triggered }.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
    },
  },
  handler: async (input) => {
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const result = await computeCommitsBehind(repoPath);

    if (!result) {
      return text(JSON.stringify({ commitsBehind: 0, status: 'unknown', triggered: false }));
    }

    const { commitsBehind } = result;
    const triggered = triggerBackgroundBuildIfNeeded(repoPath, commitsBehind, STALENESS_THRESHOLD + 1);
    const status: 'fresh' | 'stale' | 'building' =
      triggered ? 'building' : commitsBehind === 0 ? 'fresh' : 'stale';

    return text(JSON.stringify({ commitsBehind, status, triggered }));
  },
};

// ── monograph_doctor ────────────────────────────────────────────────────────

export const monographDoctorTool: MCPTool = {
  name: 'monograph_doctor',
  description: 'Run platform diagnostics — checks Node version, SQLite DB health, node count, disk space.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input) => {
    const { runDoctor } = await import('@monoes/monograph');
    const repoPath = getProjectCwd();
    const result = await runDoctor(repoPath);
    const lines = result.checks.map(c => `${c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'} ${c.name}: ${c.message}`);
    if (!result.healthy) lines.push('\nSome checks failed. Run monograph build to fix.');
    return text(lines.join('\n'));
  },
};
