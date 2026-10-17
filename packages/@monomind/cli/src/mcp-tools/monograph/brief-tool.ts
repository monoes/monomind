/**
 * monograph_brief — one call that turns a task description into a starting
 * packet: entry points with callers/callees/tests, covering docs, and the blast
 * radius of the best entry point.
 */

import type { MCPTool } from '../types.js';
import { getProjectCwd } from '../types.js';
import { _isValidDb, computeCommitsBehind, getDbPath, text } from './shared.js';

const MAX_TASK_LEN = 16 * 1024;

const loc = (n: { filePath?: string; startLine?: number }): string =>
  n.filePath ? (n.startLine != null ? `${n.filePath}:${n.startLine}` : n.filePath) : '';

export const monographBriefTool: MCPTool = {
  name: 'monograph_brief',
  description:
    'Task in plain words → best code entry points with callers, callees and tests, covering docs, and the top hit\'s blast radius (risk, files, tests to run). Use instead of chaining suggest, context and impact.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task in plain words' },
      entryPoints: { type: 'number', description: 'Default 5, max 10' },
      docs: { type: 'number', description: 'Default 3, max 10' },
    },
    required: ['task'],
  },
  handler: async (input) => {
    const dbPath = getDbPath();
    if (!_isValidDb(dbPath))
      return text('Monograph index not built yet. Run monograph_build first.');
    const raw = typeof input.task === 'string' ? input.task.trim() : '';
    if (!raw) return text('monograph_brief needs a task description.');
    const task = raw.slice(0, MAX_TASK_LEN);
    const clamp = (v: unknown, dflt: number) =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 10) : dflt;

    const { openDb, closeDb, getMonographBrief } = await import('@monoes/monograph');
    const db = openDb(dbPath);
    try {
      const brief = await getMonographBrief(db, task, {
        entryPoints: clamp(input.entryPoints, 5),
        docs: clamp(input.docs, 3),
      });
      const lines: string[] = [`Brief for: ${task}`, ''];

      if (brief.entryPoints.length === 0) {
        lines.push(
          'No code matches. Try identifiers or filenames from the codebase, or monograph_query with scope "docs".',
        );
      } else {
        lines.push(`Entry points (${brief.entryPoints.length}):`);
        for (const e of brief.entryPoints) {
          lines.push(
            `  [${e.node.label}] ${e.node.name}  ${loc(e.node)}  (score ${e.relevance.toFixed(2)})`,
          );
          if (e.callers.length)
            lines.push(`      called by: ${e.callers.map((n) => n.name).join(', ')}`);
          if (e.callees.length)
            lines.push(`      calls: ${e.callees.map((n) => n.name).join(', ')}`);
          if (e.tests.length)
            lines.push(
              `      tests: ${e.tests.slice(0, 3).join(', ')}${e.tests.length > 3 ? ` (+${e.tests.length - 3})` : ''}`,
            );
        }
      }

      if (brief.docs.length > 0) {
        lines.push('', `Docs (${brief.docs.length}):`);
        for (const d of brief.docs) lines.push(`  [${d.label}] ${d.name}  ${loc(d)}`);
      }

      if (brief.impact) {
        const i = brief.impact;
        lines.push(
          '',
          `Blast radius of ${i.name}: risk ${i.riskLevel} (${i.riskScore.toFixed(2)}), ${i.affectedFiles.length} files`,
        );
        if (i.affectedTests.length > 0) {
          lines.push(
            `  tests to run (${i.affectedTests.length}): ${i.affectedTests.slice(0, 8).join(', ')}${i.affectedTests.length > 8 ? ' …' : ''}`,
          );
        } else {
          lines.push('  tests to run: none found linked to it or its callers');
        }
      }

      const staleness = await computeCommitsBehind(getProjectCwd());
      if (staleness && staleness.commitsBehind > 0) {
        lines.push(
          '',
          `⚠ Index is ${staleness.commitsBehind} commit(s) behind HEAD — verify against the working tree.`,
        );
      }
      return text(lines.join('\n'));
    } finally {
      closeDb(db);
    }
  },
};
