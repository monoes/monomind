/**
 * `monograph search --format json` (GitHub issue #223).
 *
 * The subcommand accepted the global `--format json` flag but ignored it —
 * output was always the ASCII table, with no way to get machine-readable
 * results. Built against a REAL index (same pattern as
 * monograph-tools-real-index.test.ts) so this exercises the actual query
 * path, not a mocked one.
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
  repo = mkdtempSync(join(tmpdir(), 'mg-search-format-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(
    join(repo, 'src/service.ts'),
    `export class OrgDaemon {\n  run(): string { return 'running'; }\n}\n`,
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

describe('monograph search --format json', () => {
  it('emits JSON (not a table) and the results are structured data', async () => {
    const { default: monographCommand } = await import('../commands/monograph.js');
    const search = monographCommand.subcommands?.find((c) => c.name === 'search');
    if (!search?.action) throw new Error('search subcommand not found');

    const printJsonSpy = vi.spyOn(output, 'printJson');
    const printTableSpy = vi.spyOn(output, 'printTable');
    try {
      const result = await search.action(ctx({ query: 'OrgDaemon', path: repo, format: 'json' }));

      expect(result?.success).toBe(true);
      expect(printJsonSpy).toHaveBeenCalledTimes(1);
      expect(printTableSpy).not.toHaveBeenCalled();

      const emitted = printJsonSpy.mock.calls[0][0] as { count: number; results: unknown[] };
      expect(emitted.count).toBeGreaterThan(0);
      expect(Array.isArray(emitted.results)).toBe(true);
      expect(JSON.stringify(emitted.results)).toContain('OrgDaemon');

      // The return value's `data` is the same structured results — a
      // caller consuming the action programmatically (not just piping
      // stdout) also gets structured data now, not just the print path.
      expect(Array.isArray(result?.data)).toBe(true);
    } finally {
      printJsonSpy.mockRestore();
      printTableSpy.mockRestore();
    }
  });

  it('still prints the ASCII table when --format is not json (no regression)', async () => {
    const { default: monographCommand } = await import('../commands/monograph.js');
    const search = monographCommand.subcommands?.find((c) => c.name === 'search');
    if (!search?.action) throw new Error('search subcommand not found');

    const printJsonSpy = vi.spyOn(output, 'printJson');
    const printTableSpy = vi.spyOn(output, 'printTable');
    try {
      const result = await search.action(ctx({ query: 'OrgDaemon', path: repo }));

      expect(result?.success).toBe(true);
      expect(printTableSpy).toHaveBeenCalledTimes(1);
      expect(printJsonSpy).not.toHaveBeenCalled();
    } finally {
      printJsonSpy.mockRestore();
      printTableSpy.mockRestore();
    }
  });
});
