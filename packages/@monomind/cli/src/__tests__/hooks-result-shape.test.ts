/**
 * Follow-up to #341: every `hooks` subcommand's text output must print only
 * what its hooks_* MCP tool actually returns.
 *
 * Each CLI command declared its own copy of the tool's result shape, and the
 * tools changed underneath them. The text output then printed `undefined`,
 * `NaN`, blanks, hard-coded placeholders (a 384 dimension, a 0% cache hit rate,
 * `Exists: Yes`) or crashed on a missing sub-object. `--format json` was never
 * affected — it prints the tool result as-is.
 *
 * These tests call each command against the real in-process handler in a temp
 * project dir (MONOMIND_CWD) and compare the text to the `data` the same call
 * returned.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hooksCommand } from '../commands/hooks.js';
import {
  postCommandCommand,
  postEditCommand,
  preEditCommand,
} from '../commands/hooks-core-commands.js';
import {
  modelOutcomeCommand,
  modelRouteCommand,
  modelStatsCommand,
} from '../commands/hooks-extended-commands.js';
import {
  explainCommand,
  pretrainCommand,
  transferFromProjectCommand,
} from '../commands/hooks-routing-commands.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

function makeCtx(args: string[], flags: Record<string, unknown>, cwd: string): CommandContext {
  return { args, flags: { _: [], ...flags }, cwd, interactive: false };
}

/** Run a command's action and capture everything it wrote to stdout/stderr. */
async function run(
  cmd: Command,
  ctx: CommandContext,
): Promise<{ text: string; result: CommandResult }> {
  const chunks: string[] = [];
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
  }
  try {
    const result = (await cmd.action?.(ctx)) as CommandResult;
    return { text: chunks.join(''), result };
  } finally {
    vi.restoreAllMocks();
  }
}

function expectClean(text: string) {
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('NaN');
  expect(text).not.toContain('[object Object]');
}

const sub = (name: string) => hooksCommand.subcommands?.find((c) => c.name === name) as Command;

describe('hooks text output matches the MCP tool result (#341 follow-up)', () => {
  let dir: string;
  const savedHome = process.env.HOME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-shape-'));
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    process.env.HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it('pre-edit does not print the placeholder file-exists flag or learned pattern', async () => {
    const { text, result } = await run(preEditCommand, makeCtx(['nope.ts'], {}, dir));
    expect(result.success).toBe(true);
    expectClean(text);
    // The tool hard-codes fileExists: true and one 85% "<ext> file editing" pattern.
    expect(text).not.toContain('Exists:');
    expect(text).not.toContain('Learned Patterns');
    expect(text).toContain(
      `Type: ${(result.data as { context: { fileType: string } }).context.fileType}`,
    );
  });

  it('post-edit reports whether the learning feedback was recorded', async () => {
    const { text, result } = await run(postEditCommand, makeCtx(['a.ts'], { success: true }, dir));
    const data = result.data as { feedback: { recorded: boolean; controller: string } };
    expect(result.success).toBe(true);
    expectClean(text);
    expect(text).toContain(
      `Learning feedback: ${data.feedback.recorded ? `recorded (${data.feedback.controller})` : 'not recorded'}`,
    );
  });

  it('post-command reports the exit code and where the outcome was stored', async () => {
    const { text, result } = await run(
      postCommandCommand,
      makeCtx(['npm test'], { 'exit-code': 2 }, dir),
    );
    const data = result.data as {
      recorded: boolean;
      success: boolean;
      exitCode: number;
      _storedIn: string;
    };
    expect(result.success).toBe(true);
    expectClean(text);
    expect(data.recorded).toBe(true);
    expect(text).toContain(
      `Command outcome recorded as failure (exit code ${data.exitCode}, ${data._storedIn})`,
    );
  });

  it('session-end prints only the summary counts the tool returns', async () => {
    const { text, result } = await run(sub('session-end'), makeCtx([], {}, dir));
    const data = result.data as {
      summary: { tasksExecuted: number; agentsSpawned: number; memoryEntries: number };
      sessionPersistence: { persisted: boolean; controller: string };
    };
    expect(result.success).toBe(true);
    expectClean(text);
    // Not returned by the tool (Duration, Succeeded, Failed, Commands) or
    // hard-coded to 0 (Files Modified).
    for (const gone of [
      'Duration',
      'Tasks Succeeded',
      'Tasks Failed',
      'Commands Executed',
      'Files Modified',
    ]) {
      expect(text).not.toContain(gone);
    }
    expect(text).toMatch(new RegExp(`Tasks Executed\\s*\\|\\s*${data.summary.tasksExecuted}\\s`));
    expect(text).toMatch(new RegExp(`Agents Spawned\\s*\\|\\s*${data.summary.agentsSpawned}\\s`));
    expect(text).toMatch(new RegExp(`Memory Entries\\s*\\|\\s*${data.summary.memoryEntries}\\s`));
    // statePath names a .claude/sessions file the tool never writes.
    expect(text).not.toContain('State saved to');
    expect(text).toContain(
      `Session state: ${data.sessionPersistence.persisted ? `saved (${data.sessionPersistence.controller})` : 'not saved'}`,
    );
  });

  it('explain shows N/A, not 0.00, for factors the tool has no value for', async () => {
    const { text, result } = await run(explainCommand, makeCtx(['write unit tests'], {}, dir));
    const data = result.data as { factors: Array<{ factor: string; value: number | null }> };
    expect(result.success).toBe(true);
    expectClean(text);
    for (const f of data.factors) {
      const shown = f.value === null ? 'N/A' : f.value.toFixed(2);
      expect(text).toMatch(
        new RegExp(`${f.factor}\\s*\\|[^|]*\\|\\s*${shown.replace('.', '\\.')}\\s*\\|`),
      );
    }
    expect(data.factors.some((f) => f.value === null)).toBe(true);
  });

  it('transfer from-project reports the transferred count without crashing', async () => {
    process.env.HOME = dir;
    const source = join(dir, 'source');
    mkdirSync(join(source, '.monomind', 'neural'), { recursive: true });
    writeFileSync(
      join(source, '.monomind', 'neural', 'patterns.json'),
      JSON.stringify([
        { id: 'p1', type: 'edit', confidence: 0.9 },
        { id: 'p2', type: 'edit', confidence: 0.95 },
        { id: 'p3', type: 'route', confidence: 0.1 },
      ]),
    );
    const { text, result } = await run(transferFromProjectCommand, makeCtx([source], {}, dir));
    const data = result.data as { transferred: { total: number; byType: Record<string, number> } };
    expect(result.success).toBe(true);
    expectClean(text);
    expect(data.transferred.total).toBe(2);
    expect(text).toContain('Transferred 2 patterns');
    expect(text).toMatch(/edit\s*\|\s*2\s/);
  });

  it('transfer from-project prints the tool error instead of a count', async () => {
    process.env.HOME = dir;
    const { text, result } = await run(
      transferFromProjectCommand,
      makeCtx([join(dir, 'missing')], {}, dir),
    );
    expect(result.success).toBe(false);
    expectClean(text);
    expect(text).toContain('sourcePath does not exist');
  });

  it('pretrain does not claim semantic search was enabled when nothing was indexed', async () => {
    writeFileSync(join(dir, 'a.ts'), "import { x } from './x';\n");
    const { text, result } = await run(pretrainCommand, makeCtx([], { path: dir }, dir));
    const data = result.data as { stats: { filesAnalyzed: number; documentsIndexed?: number } };
    expect(result.success).toBe(true);
    expectClean(text);
    expect(data.stats.documentsIndexed).toBeUndefined();
    expect(text).not.toContain('Semantic search enabled');
    expect(text).toMatch(new RegExp(`Files Analyzed\\s*\\|\\s*${data.stats.filesAnalyzed}\\s`));
  });

  it('model-route does not print the tool’s fixed confidence', async () => {
    const { text, result } = await run(
      modelRouteCommand,
      makeCtx([], { task: 'refactor a module' }, dir),
    );
    const data = result.data as { complexity: number };
    expect(result.success).toBe(true);
    expectClean(text);
    // hooks_model-route always returns confidence: 0.7.
    expect(text).not.toContain('Confidence:');
    expect(text).toContain(`(${(data.complexity * 100).toFixed(0)}%)`);
  });

  it('model-stats prints the success rate and quality the ledger records', async () => {
    const ctx = (model: string, outcome: string, quality: number) =>
      makeCtx([], { task: 'refactor a module', model, outcome, quality }, dir);
    await run(modelOutcomeCommand, ctx('sonnet', 'success', 0.9));
    await run(modelOutcomeCommand, ctx('haiku', 'failure', 0.5));
    const { text, result } = await run(modelStatsCommand, makeCtx([], {}, dir));
    const data = result.data as { totalDecisions: number; successRate: number; avgQuality: number };
    expect(result.success).toBe(true);
    expectClean(text);
    expect(data.totalDecisions).toBe(2);
    // avgComplexity, avgConfidence and circuitBreakerTrips are not returned.
    expect(text).not.toContain('Avg Complexity');
    expect(text).not.toContain('Avg Confidence');
    expect(text).not.toContain('Circuit Breaker');
    expect(text).toContain(`Success Rate: ${(data.successRate * 100).toFixed(1)}%`);
    expect(text).toContain(`Avg Quality: ${(data.avgQuality * 100).toFixed(1)}%`);
  });

  it('intelligence does not print placeholder HNSW dimension or cache hit rate', async () => {
    const { text, result } = await run(sub('intelligence'), makeCtx([], {}, dir));
    const data = result.data as { components: { embeddings: { dimension: number } } };
    expect(result.success).toBe(true);
    expectClean(text);
    expect(text).not.toContain('Cache Hit Rate');
    const dims = [...text.matchAll(/Dimension\s*\|\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(dims).toEqual([data.components.embeddings.dimension]);
  });
});
