// packages/@monomind/cli/src/__tests__/cleanup-provider-artifacts.test.ts
//
// `init` writes provider-specific artifacts for agent tools other than
// Claude (.gemini/, .opencode/, .codex/, .kimi-code/, .agents/, plus
// GEMINI.md, opencode.json, AGENTS.md, .mcp.json at the project root — see
// write-antigravity.ts, write-opencode.ts, write-codex.ts, write-kimicode.ts
// and shared-instructions-generator.ts). `cleanup --force` must remove what
// `init` creates, or these are left orphaned after cleanup.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupCommand } from '../commands/cleanup.js';
import type { CommandContext } from '../types.js';

function makeCtx(cwd: string, flags: Record<string, unknown>): CommandContext {
  return {
    cwd,
    flags,
    args: [],
  } as unknown as CommandContext;
}

describe('cleanup --force removes other-provider artifacts', () => {
  let cwd: string;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it('removes .gemini, .opencode, .codex, .kimi-code, .agents dirs and their root files', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'cleanup-provider-artifacts-'));

    // What init actually writes — provably monomind's: files named monomind*,
    // content that is only monomind marker blocks, the generator's GEMINI.md
    // title line, and JSON files holding only the `monomind` server entry.
    // (Hand-written or git-tracked files are kept: cleanup-ownership-safety.test.ts.)
    for (const dir of ['.gemini', '.opencode', '.codex', '.kimi-code', '.agents']) {
      mkdirSync(join(cwd, dir), { recursive: true });
      writeFileSync(join(cwd, dir, 'monomind.md'), 'x');
    }
    writeFileSync(
      join(cwd, 'AGENTS.md'),
      '# monomind:start instructions:codex\nx\n# monomind:end instructions:codex\n',
    );
    writeFileSync(join(cwd, 'GEMINI.md'), '# Monomind for Antigravity (agy) — v2.15.6\n\nbody\n');
    writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: { monomind: {} } }));
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { monomind: {} } }));

    const result = await cleanupCommand.action?.(makeCtx(cwd, { force: true }));

    expect(result?.success).toBe(true);
    for (const dir of ['.gemini', '.opencode', '.codex', '.kimi-code', '.agents']) {
      expect(existsSync(join(cwd, dir))).toBe(false);
    }
    for (const file of ['GEMINI.md', 'opencode.json', 'AGENTS.md', '.mcp.json']) {
      expect(existsSync(join(cwd, file))).toBe(false);
    }
  });

  it('dry run (no --force) reports but does not remove other-provider artifacts', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'cleanup-provider-artifacts-dryrun-'));
    mkdirSync(join(cwd, '.opencode'), { recursive: true });
    writeFileSync(join(cwd, 'opencode.json'), 'x');

    const result = await cleanupCommand.action?.(makeCtx(cwd, {}));

    expect(result?.success).toBe(true);
    expect(existsSync(join(cwd, '.opencode'))).toBe(true);
    expect(existsSync(join(cwd, 'opencode.json'))).toBe(true);
  });
});
