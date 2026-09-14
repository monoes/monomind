import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeClaudeMd } from '../init/write-claude.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

// Mirrors the before-state from GH #241: hand-authored, git-committed
// Go-specific content plus a legitimately-appended `instructions:claude`
// block from an earlier, non-force init.
const GO_CLAUDE_MD = `# CLAUDE.md

## Project

mono-agent (\`github.com/monoes/mono-agent\`) — local-first workflow
automation engine (n8n alternative) in a single Go binary: \`monoagentcli\`.
Full agent guidance lives in **AGENTS.md** (root) — read that first.

## Build / test / lint

\`\`\`bash
go build ./...
go test ./...
go vet ./...
\`\`\`

# monomind:start instructions:claude
# Monomind

Use the \`monomind\` MCP tools for graph navigation, impact analysis, memory, and organization work.
# monomind:end instructions:claude
`;

describe('writeClaudeMd --force preserves hand-authored content (GH #241)', () => {
  let tmp: string;
  let projectDir: string;
  let claudeMdPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-write-claude-md-'));
    projectDir = join(tmp, 'project');
    mkdirSync(projectDir, { recursive: true });
    claudeMdPath = join(projectDir, 'CLAUDE.md');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('preserves hand-authored content outside the managed block on --force', async () => {
    writeFileSync(claudeMdPath, GO_CLAUDE_MD);

    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir, force: true };
    await writeClaudeMd(projectDir, options, freshResult());

    const after = readFileSync(claudeMdPath, 'utf-8');
    expect(after).toContain('mono-agent (`github.com/monoes/mono-agent`)');
    expect(after).toContain('go build ./...');
    expect(after).toContain('go test ./...');
    expect(after).toContain('go vet ./...');
    // The pre-existing, separately-owned instructions:claude block (written
    // by a different subsystem) must survive untouched too.
    expect(after).toContain('# monomind:start instructions:claude');
    expect(after).toContain('Use the `monomind` MCP tools');
  });

  it('still writes the freshly generated monomind body, confined to its own block', async () => {
    writeFileSync(claudeMdPath, GO_CLAUDE_MD);

    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir, force: true };
    await writeClaudeMd(projectDir, options, freshResult());

    const after = readFileSync(claudeMdPath, 'utf-8');
    expect(after).toContain('# Claude Code Configuration - Monomind');
    expect(after).toContain('## Behavioral Rules (Always Enforced)');
  });

  it('does not silently discard content the way a raw overwrite would (negative control)', async () => {
    writeFileSync(claudeMdPath, GO_CLAUDE_MD);
    const before = readFileSync(claudeMdPath, 'utf-8');

    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir, force: true };
    await writeClaudeMd(projectDir, options, freshResult());

    const after = readFileSync(claudeMdPath, 'utf-8');
    // A raw overwrite (today's buggy behavior) would produce content that
    // starts with the generated header and contains none of the original
    // Go-specific text — i.e. `after` would equal `generateClaudeMd()`'s
    // output verbatim. Assert the fixed behavior grew the file instead of
    // replacing it.
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.startsWith('# CLAUDE.md')).toBe(true);
  });

  it('refreshes the managed block in place on a second --force, without duplicating or losing content', async () => {
    writeFileSync(claudeMdPath, GO_CLAUDE_MD);
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir, force: true };

    await writeClaudeMd(projectDir, options, freshResult());
    const afterFirst = readFileSync(claudeMdPath, 'utf-8');
    expect(afterFirst).toContain('## Behavioral Rules (Always Enforced)');

    // Mutate the managed block's content to something obviously stale, as if
    // an older monomind version had generated it.
    const stale = afterFirst.replace(
      '## Behavioral Rules (Always Enforced)',
      '## STALE BEHAVIORAL RULES FROM AN OLD VERSION',
    );
    writeFileSync(claudeMdPath, stale);

    await writeClaudeMd(projectDir, options, freshResult());
    const afterSecond = readFileSync(claudeMdPath, 'utf-8');

    // The block was actually refreshed, not just left alone...
    expect(afterSecond).toContain('## Behavioral Rules (Always Enforced)');
    expect(afterSecond).not.toContain('STALE BEHAVIORAL RULES FROM AN OLD VERSION');
    // ...hand-authored content is still intact...
    expect(afterSecond).toContain('mono-agent (`github.com/monoes/mono-agent`)');
    expect(afterSecond).toContain('# monomind:start instructions:claude');
    // ...and there is still exactly one copy of the generated body (no
    // unbounded growth across repeated --force runs).
    const occurrences = afterSecond.split('# Claude Code Configuration - Monomind').length - 1;
    expect(occurrences).toBe(1);
  });

  it('does not touch the file at all without --force when it already exists (regression guard)', async () => {
    writeFileSync(claudeMdPath, GO_CLAUDE_MD);
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir, force: false };

    await writeClaudeMd(projectDir, options, freshResult());

    expect(readFileSync(claudeMdPath, 'utf-8')).toBe(GO_CLAUDE_MD);
  });

  it('writes a fresh CLAUDE.md wrapped in the managed block when the file does not exist yet', async () => {
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir, force: false };

    await writeClaudeMd(projectDir, options, freshResult());

    const content = readFileSync(claudeMdPath, 'utf-8');
    expect(content).toContain('# Claude Code Configuration - Monomind');
    expect(content).toContain('<!-- monomind-block:claude-md -->');
    expect(content).toContain('<!-- /monomind-block:claude-md -->');
  });
});
