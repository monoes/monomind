import type { MonographImpactResult, MonographNode } from '@monoes/monograph';
import type { MCPTool } from '../types.js';
import { ambiguityResult, nodeLocation, textWithData } from './impact-tools-shared.js';
import { getDbPath, text } from './shared.js';

// ── monograph_impact ──────────────────────────────────────────────────────────

// ── monograph_impact ──────────────────────────────────────────────────────────

export const monographImpactTool: MCPTool = {
  name: 'monograph_impact',
  description:
    'Blast radius analysis: finds all direct and transitive callers of a symbol and computes a risk score. When a name matches several definitions the candidates are listed instead of one being picked; re-query with nodeId or filePath.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Symbol name to analyze' },
      nodeId: {
        type: 'string',
        description: 'Canonical node id — unambiguous, preferred when known',
      },
      filePath: {
        type: 'string',
        description: 'Disambiguate a name by file path (exact, or a trailing fragment)',
      },
      depth: { type: 'number', description: 'Max BFS depth (default 3, max 6)' },
    },
    required: ['name'],
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { getMonographImpact } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      // Cap name/filePath; enforce depth ≤ 6 as documented in the schema description.
      const MAX_IMPACT_NAME_LEN = 512;
      const MAX_IMPACT_PATH_LEN = 4 * 1024;
      const rawImpactName = input.name as string;
      const impactName =
        typeof rawImpactName === 'string' && rawImpactName.length > MAX_IMPACT_NAME_LEN
          ? rawImpactName.slice(0, MAX_IMPACT_NAME_LEN)
          : rawImpactName;
      const rawImpactPath = input.filePath as string | undefined;
      const impactPath =
        typeof rawImpactPath === 'string' && rawImpactPath.length > MAX_IMPACT_PATH_LEN
          ? rawImpactPath.slice(0, MAX_IMPACT_PATH_LEN)
          : rawImpactPath;
      const rawDepth = input.depth as number | undefined;
      const depth =
        rawDepth === undefined
          ? undefined
          : typeof rawDepth === 'number' && Number.isFinite(rawDepth) && rawDepth > 0
            ? Math.min(Math.floor(rawDepth), 6)
            : 3;
      const result: MonographImpactResult = getMonographImpact(db, {
        name: impactName,
        filePath: impactPath,
        nodeId: input.nodeId as string | undefined,
        depth,
      });
      if (result.ambiguous) return ambiguityResult(impactName, result.candidates ?? []);
      const root = result.node;
      if (!root) return text(`No symbol found: ${impactName}`);

      // Depth lives on the transitiveCallers grouping, not on the nodes — pair
      // each node with the depth the library reported it at.
      const callers: Array<{ node: MonographNode; depth: number }> = [
        ...result.directCallers.map((node) => ({ node, depth: 1 })),
        ...result.transitiveCallers.flatMap((group) =>
          group.nodes.map((node) => ({ node, depth: group.depth })),
        ),
      ];

      const MAX_LISTED_CALLERS = 20;
      const shown = callers.slice(0, MAX_LISTED_CALLERS);
      const lines: string[] = [
        `[${root.label}] ${root.name}  ${nodeLocation(root)}`,
        '',
        // affectedFiles counts FILES, not symbols — the caller lists are the symbols.
        `Blast radius: ${callers.length} symbols across ${result.affectedFiles.length} files`,
        // Risk label comes from the library's own computeRiskLevel thresholds so
        // the severity shown here can never disagree with the score beside it.
        `Risk: ${result.riskLevel} (${result.riskScore.toFixed(2)})`,
        '',
      ];
      if (result.affectedTests.length > 0) {
        const MAX_LISTED_TESTS = 15;
        lines.push(`Tests to run (${result.affectedTests.length}):`);
        for (const t of result.affectedTests.slice(0, MAX_LISTED_TESTS)) lines.push(`  ${t}`);
        if (result.affectedTests.length > MAX_LISTED_TESTS)
          lines.push(`  … ${result.affectedTests.length - MAX_LISTED_TESTS} more`);
        lines.push('');
      } else {
        lines.push('Tests to run: none found linked to this symbol or its callers.', '');
      }

      if (callers.length > 0) {
        lines.push(`Callers (${callers.length}, showing ${shown.length}):`);
        for (const { node, depth: callerDepth } of shown) {
          lines.push(
            `  [${node.label}] ${node.name}  ${nodeLocation(node)} [depth ${callerDepth}]`,
          );
        }
        if (callers.length > shown.length) {
          lines.push(`  … ${callers.length - shown.length} more`);
        }
      }

      return textWithData(lines.join('\n').trim(), {
        symbol: {
          id: root.id,
          name: root.name,
          label: root.label,
          filePath: root.filePath ?? null,
          startLine: root.startLine ?? null,
        },
        maxDepth: Math.min(depth ?? 3, 6),
        riskScore: result.riskScore,
        riskLevel: result.riskLevel,
        affectedFileCount: result.affectedFiles.length,
        affectedFiles: result.affectedFiles,
        affectedTests: result.affectedTests,
        affectedSymbolCount: callers.length,
        callers: callers.map(({ node, depth: callerDepth }) => ({
          id: node.id,
          name: node.name,
          label: node.label,
          filePath: node.filePath ?? null,
          startLine: node.startLine ?? null,
          depth: callerDepth,
        })),
        truncated: {
          callersListedInText: shown.length,
          callersOmittedFromText: callers.length - shown.length,
        },
      });
    } finally {
      closeDb(db);
    }
  },
};

// ── monograph_api_impact ──────────────────────────────────────────────────────

// ── monograph_api_impact ──────────────────────────────────────────────────────

export const monographApiImpactTool: MCPTool = {
  name: 'monograph_api_impact',
  description:
    'Analyze the blast radius of an API route: finds the handler, performs forward BFS through CALLS edges, and computes a risk score.',
  inputSchema: {
    type: 'object',
    properties: {
      routePath: { type: 'string', description: 'Route path to analyze (e.g. /api/users)' },
      method: { type: 'string', description: 'Optional HTTP method filter: GET, POST, etc.' },
    },
    required: ['routePath'],
  },
  handler: async (input) => {
    const { openDb, closeDb } = await import('@monoes/monograph');
    const { getMonographApiImpact } = await import('@monoes/monograph');
    const db = openDb(getDbPath());
    try {
      const result = getMonographApiImpact(db, {
        routePath: input.routePath as string,
        method: input.method as string | undefined,
      });
      if (!result.route)
        return text(
          `Route not found: ${input.routePath as string}. Run monograph_build or check the path.`,
        );
      const riskLabel =
        result.riskScore >= 0.7 ? 'HIGH' : result.riskScore >= 0.4 ? 'MEDIUM' : 'LOW';
      const lines: string[] = [
        `Route: ${result.route.method} ${result.route.path}  risk=${riskLabel} (${result.riskScore.toFixed(2)})`,
      ];
      if (result.handler) {
        const hLoc = result.handler.filePath
          ? result.handler.startLine != null
            ? `${result.handler.filePath}:${result.handler.startLine}`
            : result.handler.filePath
          : '';
        lines.push(`Handler: ${result.handler.name}${hLoc ? `  ${hLoc}` : ''}`);
      }
      if (result.callees.length > 0) {
        lines.push(`Callees (${result.callees.length}):`);
        for (const c of result.callees.slice(0, 15)) {
          const loc = c.node.filePath
            ? c.node.startLine != null
              ? `${c.node.filePath}:${c.node.startLine}`
              : c.node.filePath
            : '';
          lines.push(
            `  ${'  '.repeat(c.depth)}→ ${c.node.name} [${c.node.label}]${loc ? `  ${loc}` : ''}`,
          );
        }
        if (result.callees.length > 15) lines.push(`  … ${result.callees.length - 15} more`);
      }
      if (result.affectedProcesses.length > 0) {
        lines.push(`Affected processes: ${result.affectedProcesses.map((p) => p.name).join(', ')}`);
      }
      return text(lines.join('\n'));
    } finally {
      closeDb(db);
    }
  },
};
