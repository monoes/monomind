import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext, CommandResult } from '../types.js';

// hooks_post-edit and hooks_post-command both dynamically `import('../memory/memory-bridge.js')`
// and — when a real backend loads — that module lazily spins up a LanceDB instance plus a
// HuggingFace transformers embedding pipeline (network/model-load territory). Mocking just
// this one dependency lets the command handlers under test run for real (real MCP tool
// registry dispatch, real risk assessment, real file writes for command-outcomes.jsonl)
// without paying for or depending on that heavy subsystem.
const bridgeRecordFeedback = vi.fn(async (_opts: unknown) => ({ success: true, id: 'mock-feedback-id' }));
const bridgeStoreEntry = vi.fn(async (_opts: unknown) => ({ success: true, id: 'mock-entry-id' }));
vi.mock('../memory/memory-bridge.js', () => ({
  bridgeRecordFeedback: (opts: unknown) => bridgeRecordFeedback(opts),
  bridgeStoreEntry: (opts: unknown) => bridgeStoreEntry(opts),
}));

let preEditCommand: typeof import('../commands/hooks-core-commands.js')['preEditCommand'];
let postEditCommand: typeof import('../commands/hooks-core-commands.js')['postEditCommand'];
let preCommandCommand: typeof import('../commands/hooks-core-commands.js')['preCommandCommand'];
let postCommandCommand: typeof import('../commands/hooks-core-commands.js')['postCommandCommand'];

beforeEach(async () => {
  const mod = await import('../commands/hooks-core-commands.js');
  preEditCommand = mod.preEditCommand;
  postEditCommand = mod.postEditCommand;
  preCommandCommand = mod.preCommandCommand;
  postCommandCommand = mod.postCommandCommand;
});

// Command['action'] is typed Promise<CommandResult | void> (the void covers commands
// with no handler); every command tested here always returns a CommandResult, so this
// narrows that away instead of sprinkling non-null assertions across every call site.
async function run(
  command: { action?: (ctx: CommandContext) => Promise<CommandResult | void> },
  ctx: CommandContext
): Promise<CommandResult> {
  const result = await command.action!(ctx);
  if (!result) throw new Error(`${JSON.stringify(ctx.flags)} produced no CommandResult`);
  return result;
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    args: [],
    flags: { _: [], format: 'json' },
    cwd: process.cwd(),
    interactive: false,
    ...overrides,
  };
}

// Silences the human-readable output (boxes/tables/lists) that every command
// prints regardless of --format, so test output stays clean. Text-mode
// assertions below read back what was written via this spy.
function captureStdout() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    chunks.push(String(chunk));
    return true;
  });
  return { spy, text: () => chunks.join('') };
}

describe('hooks-core-commands', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-core-commands-test-'));
    process.env.MONOMIND_CWD = dir;
    bridgeRecordFeedback.mockClear();
    bridgeStoreEntry.mockClear();
    bridgeRecordFeedback.mockResolvedValue({ success: true, id: 'mock-feedback-id' });
    bridgeStoreEntry.mockResolvedValue({ success: true, id: 'mock-entry-id' });
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  // ============================================
  // pre-edit
  // ============================================
  describe('pre-edit', () => {
    it('returns file context and suggested agents for a real, existing .ts file', async () => {
      const filePath = join(dir, 'utils.ts');
      writeFileSync(filePath, 'export const x = 1;\n', 'utf-8');

      const { spy } = captureStdout();
      try {
        const result = await run(preEditCommand, makeCtx({ flags: { _: [], format: 'json', file: filePath } }));
        expect(result.success).toBe(true);
        const data = result.data as any;
        expect(data.filePath).toBe(filePath);
        expect(data.operation).toBe('update');
        expect(data.context.fileType).toBe('.ts');
        expect(data.context.suggestedAgents).toEqual(['coder', 'architect', 'tester']);
        expect(data.context.patterns).toEqual([{ pattern: '.ts file editing', confidence: 0.85 }]);
        expect(data.context.risks).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });

    it('returns the same shape for a file path that does not exist on disk', async () => {
      // The handler does not stat the filesystem — fileExists is hardcoded true
      // regardless of real existence. Documenting that actual (surprising) behavior.
      const filePath = join(dir, 'does-not-exist.ts');
      expect(existsSync(filePath)).toBe(false);

      const { spy } = captureStdout();
      try {
        const result = await run(preEditCommand, makeCtx({ flags: { _: [], format: 'json', file: filePath } }));
        const data = result.data as any;
        expect(data.context.fileExists).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('branches suggested agents by file extension (.md vs .py vs no extension)', async () => {
      const { spy } = captureStdout();
      try {
        const md = await run(preEditCommand, makeCtx({ flags: { _: [], format: 'json', file: 'README.md' } }));
        expect((md.data as any).context.suggestedAgents).toEqual(['researcher', 'documenter']);

        const py = await run(preEditCommand, makeCtx({ flags: { _: [], format: 'json', file: 'script.py' } }));
        expect((py.data as any).context.suggestedAgents).toEqual(['coder', 'ml-developer', 'researcher']);

        const noExt = await run(preEditCommand, makeCtx({ flags: { _: [], format: 'json', file: 'Makefile' } }));
        expect((noExt.data as any).context.fileType).toBe('unknown');
        expect((noExt.data as any).context.suggestedAgents).toEqual(['coder', 'architect']);
      } finally {
        spy.mockRestore();
      }
    });

    it('recognizes test files (.test.ts) and suggests tester/reviewer regardless of extension mapping', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(preEditCommand, 
          makeCtx({ flags: { _: [], format: 'json', file: 'src/utils.test.ts' } })
        );
        expect((result.data as any).context.suggestedAgents).toEqual(['tester', 'reviewer']);
      } finally {
        spy.mockRestore();
      }
    });

    it('flags deletion as a risk when operation=delete, but not for the default update operation', async () => {
      const { spy } = captureStdout();
      try {
        const del = await run(preEditCommand, 
          makeCtx({ flags: { _: [], format: 'json', file: 'x.ts', operation: 'delete' } })
        );
        expect((del.data as any).context.risks).toEqual(['File deletion is irreversible']);

        const update = await run(preEditCommand, makeCtx({ flags: { _: [], format: 'json', file: 'x.ts' } }));
        expect((update.data as any).context.risks).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });

    it('defaults filePath to "unknown" when neither args nor --file are given', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(preEditCommand, makeCtx());
        expect((result.data as any).filePath).toBe('unknown');
      } finally {
        spy.mockRestore();
      }
    });

    it('prints a human-readable File Context box in non-json (text) mode', async () => {
      const { spy, text } = captureStdout();
      try {
        const result = await run(preEditCommand, makeCtx({ flags: { _: [], file: 'x.ts' } }));
        expect(result.success).toBe(true);
        expect(text()).toContain('File Context');
        expect(text()).toContain('Suggested Agents');
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ============================================
  // post-edit
  // ============================================
  describe('post-edit', () => {
    it('records a successful edit outcome and forwards it to the feedback bridge with outcome=success', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(postEditCommand, 
          makeCtx({ flags: { _: [], format: 'json', file: 'src/a.ts', success: true } })
        );
        expect(result.success).toBe(true);
        const data = result.data as any;
        expect(data.recorded).toBe(true);
        expect(data.success).toBe(true);
        expect(data.learningUpdate).toBe('pattern_reinforced');
        expect(data.feedback).toEqual({ recorded: true, controller: 'lancedb', updates: 1 });

        expect(bridgeRecordFeedback).toHaveBeenCalledTimes(1);
        const call = bridgeRecordFeedback.mock.calls[0][0] as any;
        expect(call.outcome).toBe('success');
        expect(call.action).toBe('edit src/a.ts');
        expect(call.confidence).toBe(0.85);
      } finally {
        spy.mockRestore();
      }
    });

    it('records a failed edit outcome with outcome=failure and a lower confidence', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(postEditCommand, 
          makeCtx({ flags: { _: [], format: 'json', file: 'src/a.ts', success: false, outcome: 'Type error' } })
        );
        const data = result.data as any;
        expect(data.success).toBe(false);
        expect(data.learningUpdate).toBe('pattern_adjusted');

        expect(bridgeRecordFeedback).toHaveBeenCalledTimes(1);
        const call = bridgeRecordFeedback.mock.calls[0][0] as any;
        expect(call.outcome).toBe('failure');
        expect(call.confidence).toBe(0.3);
      } finally {
        spy.mockRestore();
      }
    });

    it('defaults success to true when --success is not passed (PostToolUse compat)', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(postEditCommand, makeCtx({ flags: { _: [], format: 'json', file: 'src/a.ts' } }));
        expect((result.data as any).success).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('degrades gracefully (feedback.recorded=false) when the feedback bridge throws', async () => {
      bridgeRecordFeedback.mockRejectedValueOnce(new Error('backend unavailable'));
      const { spy } = captureStdout();
      try {
        const result = await run(postEditCommand, 
          makeCtx({ flags: { _: [], format: 'json', file: 'src/a.ts', success: true } })
        );
        // The command itself still succeeds — the bridge failure is caught internally.
        expect(result.success).toBe(true);
        const data = result.data as any;
        expect(data.recorded).toBe(true);
        expect(data.feedback).toEqual({ recorded: false, controller: 'unavailable', updates: 0 });
      } finally {
        spy.mockRestore();
      }
    });

    it('prints a success line and no filesystem writes are required for the command to succeed', async () => {
      const { spy, text } = captureStdout();
      try {
        const result = await run(postEditCommand, 
          makeCtx({ flags: { _: [], file: 'src/a.ts', success: true, metrics: 'time:500,quality:0.95' } })
        );
        expect(result.success).toBe(true);
        expect(text()).toContain('Outcome recorded for src/a.ts');
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ============================================
  // pre-command
  // ============================================
  describe('pre-command', () => {
    it('assesses an obviously safe command ("ls -la") as low risk and shouldProceed=true', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(preCommandCommand, 
          makeCtx({ flags: { _: [], format: 'json', command: 'ls -la' } })
        );
        expect(result.success).toBe(true);
        const data = result.data as any;
        expect(data.riskLevel).toBe('low');
        expect(data.shouldProceed).toBe(true);
        expect(data.risks).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });

    it('assesses an obviously risky command ("rm -rf dist") as critical risk and shouldProceed=false', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(preCommandCommand, 
          makeCtx({ flags: { _: [], format: 'json', command: 'rm -rf dist' } })
        );
        const data = result.data as any;
        expect(data.riskLevel).toBe('critical');
        expect(data.shouldProceed).toBe(false);
        expect(data.risks).toEqual([
          { type: 'risk-1', severity: 'high', description: 'Recursive deletion detected - verify target path' },
        ]);
      } finally {
        spy.mockRestore();
      }
    });

    it('assesses a medium-severity risk ("sudo apt install foo") as high, distinct from critical', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(preCommandCommand, 
          makeCtx({ flags: { _: [], format: 'json', command: 'sudo apt install foo' } })
        );
        const data = result.data as any;
        expect(data.riskLevel).toBe('high');
        expect(data.shouldProceed).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it('fails with exit code 1 and no risk assessment call when command is missing', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(preCommandCommand, makeCtx({ flags: { _: [], format: 'json' } }));
        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('prints a Risk Assessment box with the risk level in text mode', async () => {
      const { spy, text } = captureStdout();
      try {
        await run(preCommandCommand, makeCtx({ flags: { _: [], command: 'rm -rf /tmp/x' } }));
        expect(text()).toContain('Risk Assessment');
        expect(text()).toContain('Identified Risks');
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ============================================
  // post-command
  // ============================================
  describe('post-command', () => {
    it('records a successful command outcome (exit code 0) to the real command-outcomes.jsonl file', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(postCommandCommand, 
          makeCtx({ flags: { _: [], format: 'json', command: 'npm test', 'exit-code': 0 } })
        );
        expect(result.success).toBe(true);
        const data = result.data as any;
        expect(data.success).toBe(true);
        expect(data.exitCode).toBe(0);
        expect(data.recorded).toBe(true);

        const outcomesPath = join(dir, '.monomind', 'command-outcomes.jsonl');
        expect(existsSync(outcomesPath)).toBe(true);
        const lines = readFileSync(outcomesPath, 'utf-8').trim().split('\n');
        const last = JSON.parse(lines[lines.length - 1]);
        expect(last.command).toBe('npm test');
        expect(last.exitCode).toBe(0);
        expect(last.success).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('records a failed command outcome (non-zero exit code) — outcome success is derived from exitCode, not the --success flag', async () => {
      const { spy } = captureStdout();
      try {
        // Passing --success (unused by the handler for the derived flag) alongside a
        // non-zero exit code: the recorded/returned success is driven by exitCode only.
        const result = await run(postCommandCommand, 
          makeCtx({ flags: { _: [], format: 'json', command: 'npm run build', success: true, 'exit-code': 1 } })
        );
        const data = result.data as any;
        expect(data.exitCode).toBe(1);
        expect(data.success).toBe(false);

        const outcomesPath = join(dir, '.monomind', 'command-outcomes.jsonl');
        const lines = readFileSync(outcomesPath, 'utf-8').trim().split('\n');
        const last = JSON.parse(lines[lines.length - 1]);
        expect(last.exitCode).toBe(1);
        expect(last.success).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it('defaults exit code to 0 (success) when --exit-code is not passed', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(postCommandCommand, 
          makeCtx({ flags: { _: [], format: 'json', command: 'echo hi' } })
        );
        expect((result.data as any).exitCode).toBe(0);
        expect((result.data as any).success).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('fails with exit code 1 when command is missing', async () => {
      const { spy } = captureStdout();
      try {
        const result = await run(postCommandCommand, makeCtx({ flags: { _: [], format: 'json' } }));
        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('prints a confirmation line in text mode', async () => {
      const { spy, text } = captureStdout();
      try {
        const result = await run(postCommandCommand, 
          makeCtx({ flags: { _: [], command: 'npm run lint', 'exit-code': 0 } })
        );
        expect(result.success).toBe(true);
        expect(text()).toContain('Command outcome recorded');
      } finally {
        spy.mockRestore();
      }
    });
  });
});
