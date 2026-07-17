/**
 * Tests for src/commands/hooks-workers.ts: the CLI "hooks worker list" and
 * "hooks worker run <name>" subcommands, which wrap the real WorkerManager
 * exported by @monomind/hooks.
 *
 * The workers' own internal logic (all 15 built-in workers) is already
 * covered by packages/@monomind/hooks/__tests__/workers.test.ts. This file
 * only covers the CLI layer on top: listing WORKER_CONFIGS correctly,
 * running a worker end to end against a real temp project directory, and
 * the error path for an unknown worker name.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../types.js';
import { workerCommand } from '../commands/hooks-workers.js';
import { WORKER_CONFIGS, WorkerPriority } from '@monomind/hooks';

function makeCtx(args: string[], flags: Record<string, unknown> = {}, cwd?: string): CommandContext {
  return {
    args,
    flags: { _: [], ...flags },
    cwd: cwd ?? process.cwd(),
    interactive: false,
  };
}

const workerListCommand = workerCommand.subcommands!.find((c) => c.name === 'list')!;
const workerRunCommand = workerCommand.subcommands!.find((c) => c.name === 'run')!;

describe('hooks worker (parent command)', () => {
  it('registers exactly the list and run subcommands', () => {
    const names = (workerCommand.subcommands ?? []).map((c) => c.name);
    expect(names.sort()).toEqual(['list', 'run']);
  });

  it('top-level action prints usage and succeeds', async () => {
    const result = await workerCommand.action!(makeCtx([]));
    expect(result?.success).toBe(true);
  });
});

describe('hooks worker list', () => {
  it('lists all registered @monomind/hooks workers with priority and enabled state', async () => {
    const result = await workerListCommand.action!(makeCtx([]));
    expect(result?.success).toBe(true);

    const data = result?.data as {
      workers: Array<{ name: string; priority: string; enabled: string; description: string }>;
      total: number;
    };

    // Cross-check against the real package export so this test can't
    // silently drift from the source of truth if a worker is added/removed.
    // Note: CLAUDE.md documents "15 background workers" / the parent
    // hooksCommand's own help text says "(12 workers)" — WORKER_CONFIGS
    // currently has 14 entries. Both doc references are stale; this
    // assertion tracks the real registry rather than either doc count.
    const expectedNames = Object.keys(WORKER_CONFIGS);
    expect(data.total).toBe(expectedNames.length);
    expect(data.workers.length).toBe(expectedNames.length);
    expect(expectedNames.length).toBe(14);

    const listedNames = data.workers.map((w) => w.name).sort();
    expect(listedNames).toEqual([...expectedNames].sort());

    // Priority is rendered through WorkerPriority[...] (numeric enum -> name)
    // and enabled is rendered as 'yes'/'no' strings.
    const health = data.workers.find((w) => w.name === 'health')!;
    expect(health.priority).toBe(WorkerPriority[WORKER_CONFIGS.health.priority]);
    expect(health.enabled).toBe(WORKER_CONFIGS.health.enabled ? 'yes' : 'no');
    expect(health.description).toBe(WORKER_CONFIGS.health.description);

    const cache = data.workers.find((w) => w.name === 'cache')!;
    expect(cache.priority).toBe(WorkerPriority[WORKER_CONFIGS.cache.priority]);
  });
});

describe('hooks worker run', () => {
  let dir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-worker-run-test-'));
    originalCwd = process.cwd;
    process.cwd = () => dir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the "health" worker end-to-end against a real temp project dir', async () => {
    const result = await workerRunCommand.action!(makeCtx(['health'], { format: 'json' }));

    expect(result?.success).toBe(true);
    expect(result?.exitCode).toBeUndefined();

    const data = result?.data as {
      worker: string;
      success: boolean;
      duration: number;
      data?: { status: string; memory: { usedPct: number } };
    };
    expect(data.worker).toBe('health');
    expect(data.success).toBe(true);
    expect(typeof data.duration).toBe('number');
    expect(data.data?.status).toMatch(/healthy|warning|critical/);
    expect(typeof data.data?.memory.usedPct).toBe('number');

    // ensureMetricsDir() is called by the command itself before runWorker(),
    // so .monomind/metrics/ must exist under the temp project root afterward
    // even though runWorker() alone does not create it.
    expect(existsSync(join(dir, '.monomind', 'metrics'))).toBe(true);
  });

  it('runs the "git" worker end-to-end (non-repo temp dir still succeeds, reports unavailable)', async () => {
    const result = await workerRunCommand.action!(makeCtx(['git'], { format: 'json' }));

    expect(result?.success).toBe(true);
    const data = result?.data as { worker: string; success: boolean; data?: { available: boolean } };
    expect(data.worker).toBe('git');
    expect(data.success).toBe(true);
    // The temp dir created by mkdtempSync is not a git repository, so the
    // real worker's git commands fail internally and it reports
    // available: false rather than throwing.
    expect(data.data?.available).toBe(false);
  });

  it('accepts the worker name via positional arg or --name flag identically', async () => {
    const viaArg = await workerRunCommand.action!(makeCtx(['health'], { format: 'json' }));
    const viaFlag = await workerRunCommand.action!(makeCtx([], { name: 'health', format: 'json' }));

    const argData = viaArg?.data as { worker: string; success: boolean };
    const flagData = viaFlag?.data as { worker: string; success: boolean };
    expect(argData.worker).toBe('health');
    expect(flagData.worker).toBe('health');
    expect(argData.success).toBe(true);
    expect(flagData.success).toBe(true);
  });

  it('fails cleanly, without crashing, when no worker name is given', async () => {
    const result = await workerRunCommand.action!(makeCtx([]));
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });

  it('fails cleanly, without crashing, for an unknown worker name', async () => {
    const result = await workerRunCommand.action!(makeCtx(['nonexistent-worker-name']));
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });
});
