/**
 * Regression tests for CMD-17: `mcp logs --follow` / `--level` used to be
 * accepted flags that were never read (the command always printed the last
 * N raw lines regardless). This validates the `--level` filter actually
 * filters, and that `--follow` fails loudly instead of silently doing
 * nothing when there is no log file to watch.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { logsCommand } from '../commands/mcp.js';
import type { CommandContext, CommandResult } from '../types.js';

let tmp: string;

async function runLogs(ctx: CommandContext): Promise<CommandResult> {
  const result = await logsCommand.action!(ctx);
  return result ?? { success: false };
}

function makeCtx(cwd: string, flags: Record<string, unknown>): CommandContext {
  return {
    args: [],
    flags: { _: [], ...flags } as CommandContext['flags'],
    cwd,
    interactive: false,
  };
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('mcp logs --level', () => {
  it('filters printed lines to only those matching the requested level', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mcp-logs-'));
    mkdirSync(join(tmp, '.monomind', 'logs'), { recursive: true });
    writeFileSync(
      join(tmp, '.monomind', 'logs', 'mcp-server.log'),
      ['[INFO] server started', '[ERROR] boom', '[INFO] handled request', '[ERROR] boom again'].join('\n') + '\n',
    );

    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });

    const result = await runLogs(makeCtx(tmp, { lines: 50, level: 'error' }));

    expect(result.success).toBe(true);
    const printed = written.join('');
    expect(printed).toContain('[ERROR] boom');
    expect(printed).toContain('[ERROR] boom again');
    expect(printed).not.toContain('[INFO] server started');
    expect(printed).not.toContain('[INFO] handled request');
  });

  it('reports no matches rather than silently ignoring an unmatched level', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mcp-logs-'));
    mkdirSync(join(tmp, '.monomind', 'logs'), { recursive: true });
    writeFileSync(join(tmp, '.monomind', 'logs', 'mcp-server.log'), '[INFO] only info here\n');

    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });

    const result = await runLogs(makeCtx(tmp, { lines: 50, level: 'error' }));

    expect(result.success).toBe(true);
    expect(written.join('')).toContain('no lines matching level "error"');
  });
});

describe('mcp logs --follow', () => {
  it('fails loudly instead of silently no-op-ing when there is no log file to watch', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mcp-logs-'));
    // No .monomind/logs directory at all.

    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });

    const result = await runLogs(makeCtx(tmp, { lines: 50, follow: true }));

    expect(result.success).toBe(false);
    expect(written.join('')).toContain('--follow requires an existing log file');
  });
});
