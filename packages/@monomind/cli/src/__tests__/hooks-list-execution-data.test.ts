/**
 * Regression tests for the `hooks list` table advertising execution data it
 * has no source for: the Priority, Executions and Last Executed columns were
 * blank (or a literal "Never") on every row, for every project, always.
 *
 * Same class of defect as #270: `hooks_list` returns a hardcoded registry of
 * monomind's own hook *subcommands* as `{ name, type, status }`. It has never
 * carried a priority, an execution counter or a timestamp, so the table was
 * rendering three columns keyed on fields the tool never sent.
 *
 * Nothing records those three for these rows:
 *   - priority      — `HookEntry.priority` exists only in @monoes/hooks'
 *                     in-process HookRegistry, which is empty in a `hooks list`
 *                     process and is never persisted.
 *   - executions    — no per-subcommand counter is written anywhere.
 *   - lastExecuted  — no per-hook timestamp is written anywhere;
 *                     hook-latency.json carries one global `lastUpdated`.
 *
 * What *is* real is `.monomind/metrics/hook-latency.json`: per-invocation
 * counters written by `.claude/helpers/hook-handler.cjs`, keyed by Claude Code
 * handler name — the same wiring the "Claude Code wiring" section already
 * reports, and a different namespace from the subcommand registry above. So it
 * is reported there, next to the wiring it measures, rather than folded into
 * the registry's rows.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listCommand } from '../commands/hooks-routing-commands.js';
import { hooksList } from '../mcp-tools/hooks-routing.js';
import { output } from '../output.js';
import type { CommandContext } from '../types.js';

interface HooksListResult {
  hooks: Array<Record<string, unknown>>;
  total: number;
  claudeCode: {
    configured: boolean;
    settingsPath: string;
    wired: number;
    events: string[];
    invocations: {
      metricsPath: string;
      recorded: boolean;
      handlers: Array<{ name: string; count: number; meanMs: number; maxMs: number }>;
    };
  };
}

let dir: string;
let originalCwdEnv: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monomind-hooks-exec-'));
  originalCwdEnv = process.env.MONOMIND_CWD;
  process.env.MONOMIND_CWD = dir;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCwdEnv === undefined) delete process.env.MONOMIND_CWD;
  else process.env.MONOMIND_CWD = originalCwdEnv;
  rmSync(dir, { force: true, recursive: true });
});

async function runTool(): Promise<HooksListResult> {
  return (await hooksList.handler({})) as unknown as HooksListResult;
}

function writeLatency(data: unknown): void {
  mkdirSync(join(dir, '.monomind', 'metrics'), { recursive: true });
  writeFileSync(join(dir, '.monomind', 'metrics', 'hook-latency.json'), JSON.stringify(data));
}

/** Run `hooks list` and return everything it printed. */
async function renderList(): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(output, 'writeln').mockImplementation((text = '') => {
    lines.push(text);
  });
  const ctx = { args: [], flags: {}, rawArgs: [], cwd: dir } as unknown as CommandContext;
  const action = listCommand.action;
  if (!action) throw new Error('listCommand has no action');
  const result = await action(ctx);
  expect(result?.success).toBe(true);
  return lines.join('\n');
}

describe('hooks list — columns with no data source', () => {
  it('sends no priority, execution count or last-executed field for registry rows', async () => {
    const result = await runTool();

    expect(result.hooks.length).toBeGreaterThan(0);
    for (const hook of result.hooks) {
      // These were the `undefined`s the table rendered as blanks and "Never".
      expect(hook).not.toHaveProperty('priority');
      expect(hook).not.toHaveProperty('executionCount');
      expect(hook).not.toHaveProperty('lastExecuted');
    }
  });

  it('does not print Priority, Executions or Last Executed columns', async () => {
    const rendered = await renderList();

    expect(rendered).toContain('Registered Hooks');
    expect(rendered).toContain('Name');
    expect(rendered).toContain('Enabled');
    expect(rendered).not.toContain('Priority');
    expect(rendered).not.toContain('Executions');
    expect(rendered).not.toContain('Last Executed');
    // "Never" was the permanent stand-in the Last Executed column rendered.
    expect(rendered).not.toContain('Never');
  });
});

describe('hooks list — real Claude Code handler invocation counts', () => {
  it('reports the counters hook-latency.json actually holds', async () => {
    writeLatency({
      'post-edit': { count: 646, total: 16819, max: 178, mean: 26 },
      route: { count: 500, total: 115941, max: 956, mean: 232 },
      lastUpdated: 1789718728206,
    });

    const { invocations } = (await runTool()).claudeCode;

    expect(invocations.recorded).toBe(true);
    expect(invocations.metricsPath).toBe(join(dir, '.monomind', 'metrics', 'hook-latency.json'));
    // Busiest first, and `lastUpdated` is not a handler.
    expect(invocations.handlers).toEqual([
      { name: 'post-edit', count: 646, meanMs: 26, maxMs: 178 },
      { name: 'route', count: 500, meanMs: 232, maxMs: 956 },
    ]);
  });

  it('prints those counts under the wiring they measure, not on registry rows', async () => {
    writeLatency({ 'pre-bash': { count: 4579, total: 469605, max: 1117, mean: 103 } });

    const rendered = await renderList();

    expect(rendered).toContain('pre-bash');
    expect(rendered).toContain('4579');
  });

  it('reports nothing rather than zeros when no invocations were recorded', async () => {
    const { invocations } = (await runTool()).claudeCode;

    expect(invocations.recorded).toBe(false);
    expect(invocations.handlers).toEqual([]);
  });

  it('ignores a malformed hook-latency.json instead of inventing numbers', async () => {
    writeLatency({ 'post-edit': { count: 'lots' }, 'pre-task': 7, route: null });

    const { invocations } = (await runTool()).claudeCode;

    expect(invocations.recorded).toBe(false);
    expect(invocations.handlers).toEqual([]);
  });
});
