import type { MCPTool } from '../types.js';
import { getProjectCwd } from '../types.js';
import {
  _isValidDb,
  computeCommitsBehind,
  getDbPath,
  STALENESS_THRESHOLD,
  text,
  triggerBackgroundBuildIfNeeded,
} from './shared.js';

// ── monograph_stats ─────────────────────────────────────────────────────────

export const monographStatsTool: MCPTool = {
  name: 'monograph_stats',
  description: 'Show node/edge/community counts and index freshness.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const dbPath = getDbPath();
    if (!_isValidDb(dbPath))
      return text('Monograph index not built yet. Run monograph_build first.');
    const { openDb, closeDb, countNodes, countEdges } = await import('@monoes/monograph');
    const db = openDb(dbPath);
    try {
      const nodes = countNodes(db);
      const edges = countEdges(db);
      const meta = db.prepare('SELECT key, value FROM index_meta').all() as {
        key: string;
        value: string;
      }[];
      const metaStr = meta.map((m) => `  ${m.key}: ${m.value}`).join('\n');
      return text(`Monograph index stats:\n  nodes: ${nodes}\n  edges: ${edges}\n${metaStr}`);
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_health ────────────────────────────────────────────────────────

/**
 * Anything other than `fresh` means the graph can be missing symbols the caller
 * is asking about. Say so, and say what to do instead — graph-first guidance is
 * only sound while coverage is adequate.
 */
function coverageNote(state: string): string[] {
  if (state === 'fresh') return [];
  if (state === 'building')
    return ['A rebuild is in progress — results reflect the previous build until it finishes.'];
  return [
    'Coverage warning: the graph may be incomplete or out of date, so a missing result is not',
    'evidence of absence. Ordinary code search (grep/rg over the working tree) is a legitimate',
    'fallback here — use it rather than trusting an empty or partial graph answer.',
  ];
}

export const monographHealthTool: MCPTool = {
  name: 'monograph_health',
  description:
    'Report index freshness as an explicit state (fresh / stale / building / partial / unknown) with the indexed revision, source scope, dirty-worktree status, parser warnings and last refresh error.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const { openDb, closeDb, checkStaleness } = await import('@monoes/monograph');
    const repoPath = getProjectCwd();
    const db = openDb(getDbPath());
    try {
      const nodeCount = (db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as { c: number }).c;
      if (nodeCount === 0) {
        return text('Index has never been built. Run monograph_build first.');
      }

      const report = checkStaleness(db, repoPath);
      const lines = [
        `Index status: ${report.state.toUpperCase()}`,
        `Reason: ${report.reason}`,
        `Nodes: ${nodeCount}`,
        `Indexed revision: ${report.indexedRevision ?? 'not recorded'}${
          report.indexedAt ? ` (built ${report.indexedAt})` : ''
        }`,
        `Current HEAD: ${report.currentCommit ?? 'unavailable'}`,
        `Source scope: ${report.sourceScope ?? 'not recorded'}`,
      ];

      if (report.dirtyWorktree === null) {
        lines.push('Working tree: could not be checked for uncommitted edits');
      } else if (report.dirtyWorktree) {
        const sample = report.dirtyPaths.slice(0, 10).join(', ');
        lines.push(
          `Working tree: ${report.dirtyFileCount} uncommitted path(s) not reflected in the graph — ${sample}${
            (report.dirtyFileCount ?? 0) > 10 ? ', …' : ''
          }`,
        );
      } else {
        lines.push('Working tree: clean');
      }

      if (report.changedSince.length > 0) {
        lines.push(`Files changed since the indexed revision: ${report.changedSince.length}`);
      }
      if (report.parserWarnings) {
        lines.push(
          `Parser warnings from the last build: ${report.parserWarnings.length} (e.g. ${report.parserWarnings[0]})`,
        );
      }
      if (report.lastRefreshError) {
        lines.push(`Last refresh error: ${report.lastRefreshError}`);
      }
      if (!report.indexedRevision) {
        lines.push('Run monograph_build to record a revision and enable staleness tracking.');
      }

      const note = coverageNote(report.state);
      if (note.length > 0) lines.push('', ...note);

      return text(lines.join('\n'));
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_staleness ─────────────────────────────────────────────────────

export const monographStalenessTool: MCPTool = {
  name: 'monograph_staleness',
  description:
    'Index freshness detection. Returns { commitsBehind, status, triggered } plus the evidence behind the verdict: indexed revision, source scope, dirty-worktree status, parser warnings, last refresh error, and whether graph answers may be incomplete. `status` is one of fresh | stale | building | partial | unknown — "unknown" means freshness could not be determined, not that the index is up to date. Triggers a background rebuild when the index falls far enough behind HEAD.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the repo (defaults to project cwd)' },
    },
  },
  handler: async (input) => {
    const repoPath = (input.path as string | undefined) ?? getProjectCwd();
    const result = await computeCommitsBehind(repoPath);

    const commitsBehind = result?.commitsBehind ?? 0;
    const triggered = result
      ? triggerBackgroundBuildIfNeeded(repoPath, commitsBehind, STALENESS_THRESHOLD + 1)
      : false;

    // Evidence behind the verdict — a commit count alone cannot see uncommitted
    // edits, a missing revision record, or a build that failed halfway.
    let report: import('@monoes/monograph').StalenessReport | null = null;
    const dbPath = getDbPath(input.path as string | undefined);
    if (_isValidDb(dbPath)) {
      const { openDb, closeDb, checkStaleness } = await import('@monoes/monograph');
      const db = openDb(dbPath);
      try {
        report = checkStaleness(db, repoPath);
      } finally {
        closeDb(db);
      }
    }

    if (!report) {
      return text(
        JSON.stringify({
          commitsBehind,
          status: 'unknown',
          triggered,
          reason: 'No usable monograph index was found, so freshness cannot be determined.',
          mayBeIncomplete: true,
          grepFallbackAppropriate: true,
        }),
      );
    }

    const status = triggered ? 'building' : report.state;
    return text(
      JSON.stringify({
        commitsBehind,
        status,
        triggered,
        reason: report.reason,
        indexedRevision: report.indexedRevision,
        indexedAt: report.indexedAt,
        sourceScope: report.sourceScope,
        dirtyWorktree: report.dirtyWorktree,
        dirtyFileCount: report.dirtyFileCount,
        dirtyPaths: report.dirtyPaths,
        parserWarnings: report.parserWarnings,
        lastRefreshError: report.lastRefreshError,
        mayBeIncomplete: report.mayBeIncomplete,
        // Graph-first guidance only holds while coverage does; say when it doesn't.
        grepFallbackAppropriate: status !== 'fresh' && status !== 'building',
      }),
    );
  },
};

// ── monograph_doctor ────────────────────────────────────────────────────────

export const monographDoctorTool: MCPTool = {
  name: 'monograph_doctor',
  description:
    'Run platform diagnostics — checks Node version, SQLite DB health, node count, disk space.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input) => {
    const { runDoctor } = await import('@monoes/monograph');
    const repoPath = getProjectCwd();
    const result = await runDoctor(repoPath);
    const lines = result.checks.map(
      (c) =>
        `${c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'} ${c.name}: ${c.message}`,
    );
    if (!result.healthy) lines.push('\nSome checks failed. Run monograph build to fix.');
    return text(lines.join('\n'));
  },
};
