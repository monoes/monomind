/**
 * `monograph search -q <symbol>` default (text-mode) output had no
 * line-number column — only the file path. The data was always present via
 * `--format json` (ftsSearch/hybridSearch both return startLine/endLine on
 * every row, per FtsResult/HybridSearchResult in @monoes/monograph), just
 * never surfaced in the human-readable table.
 *
 * Root cause: monograph.ts's `search` action hand-types the query results
 * with a local `SearchResult` type that omitted `startLine`/`endLine`
 * entirely, so the table-building code below never referenced them even
 * though they were present on every result object at runtime — the same
 * hand-typed-duplicate-drifts-from-the-real-shape bug class as
 * list-field-mapping.test.ts and analyze-diff-classification-fields.test.ts
 * in this package.
 *
 * Built against a REAL index (same pattern as monograph-search-format.test.ts
 * in this package), so this exercises the actual query path, not a mocked
 * one.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { output } from '../output.js';
import type { CommandContext } from '../types.js';

let repo: string;
let prevCwd: string | undefined;

beforeAll(async () => {
  prevCwd = process.env.MONOMIND_CWD;
  repo = mkdtempSync(join(tmpdir(), 'mg-search-lines-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  // The symbol sits on a known, non-1 line so a test that accidentally
  // passed on a hardcoded `line: 1` fallback would be caught.
  writeFileSync(
    join(repo, 'src/service.ts'),
    `// header comment\nexport class LineNumberProbe {\n  run(): string { return 'ok'; }\n}\n`,
  );
  writeFileSync(join(repo, '.gitignore'), '.monograph/\n.monomind/\nGRAPH_REPORT.md\n');

  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');

  process.env.MONOMIND_CWD = repo;
  process.env.MONOGRAPH_MCP_ADVANCED = '1';
  const { allMonographTools } = await import('../mcp-tools/monograph-tools.js');
  const build = allMonographTools.find((t) => t.name === 'monograph_build');
  if (!build) throw new Error('monograph_build tool not registered');
  await build.handler({ path: repo, codeOnly: true, force: true }, undefined);
}, 180_000);

afterAll(() => {
  if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
  else process.env.MONOMIND_CWD = prevCwd;
  rmSync(repo, { recursive: true, force: true });
});

function ctx(flags: Record<string, string | boolean | number>): CommandContext {
  return {
    args: [],
    flags: { _: [], ...flags },
    cwd: repo,
    interactive: false,
  };
}

describe('monograph search text-mode table includes line numbers', () => {
  it('renders a real numeric Line cell, present via JSON but previously missing from the table', async () => {
    const { default: monographCommand } = await import('../commands/monograph.js');
    const search = monographCommand.subcommands?.find((c) => c.name === 'search');
    if (!search?.action) throw new Error('search subcommand not found');

    const printTableSpy = vi.spyOn(output, 'printTable');
    try {
      const result = await search.action(
        ctx({ query: 'LineNumberProbe', path: repo, label: 'Class' }),
      );

      expect(result?.success).toBe(true);
      expect(printTableSpy).toHaveBeenCalledTimes(1);

      const call = printTableSpy.mock.calls[0][0] as {
        columns: Array<{ key: string; header: string }>;
        data: Array<Record<string, unknown>>;
      };

      expect(call.columns.some((c) => c.key === 'line')).toBe(true);
      expect(call.data.length).toBeGreaterThan(0);

      const [row] = call.data;
      // Strip ANSI so the assertion works whether or not color is enabled.
      // eslint-disable-next-line no-control-regex
      const plainLine = String(row.line).replace(/\x1b\[[0-9;]*m/g, '');
      expect(plainLine).toMatch(/^\d+$/);
      expect(Number(plainLine)).toBeGreaterThan(0);
    } finally {
      printTableSpy.mockRestore();
    }
  });
});
