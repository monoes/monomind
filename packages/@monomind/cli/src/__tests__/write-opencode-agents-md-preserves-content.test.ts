import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENTS_MD_SIGNATURE, generateAgentsMd } from '../init/opencode-generator.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeOpencodeFiles } from '../init/write-opencode.js';

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

// The before-state from GH #278: a Go repo whose AGENTS.md is hand-written
// agent guidance, committed to git, with nothing of monomind's in it.
const HAND_WRITTEN = `# AGENTS.md — mono-agent

Full agent guidance for this repository. Read this before touching anything.

## Build

\`\`\`bash
go build ./...
go test ./...
\`\`\`

## House rules
- Never commit secrets or \`.env\` files.
- Commit messages: conventional style (\`type(scope): description\`).
`;

describe('writeOpencodeFiles AGENTS.md preserves project-owned content (GH #278)', () => {
  let tmp: string;
  let projectDir: string;
  let agentsMdPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-write-opencode-agents-'));
    projectDir = join(tmp, 'project');
    mkdirSync(projectDir, { recursive: true });
    agentsMdPath = join(projectDir, 'AGENTS.md');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function forceOptions() {
    return {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components, opencode: true },
    };
  }

  it('keeps a hand-written AGENTS.md verbatim on --force', async () => {
    writeFileSync(agentsMdPath, HAND_WRITTEN);

    await writeOpencodeFiles(projectDir, forceOptions(), freshResult());

    const after = readFileSync(agentsMdPath, 'utf-8');
    expect(after).toContain('# AGENTS.md — mono-agent');
    expect(after).toContain('Full agent guidance for this repository.');
    expect(after).toContain('go build ./...');
    expect(after).toContain('Never commit secrets or `.env` files.');
    // The whole original file is still there, unmodified, as a prefix.
    expect(after.startsWith(HAND_WRITTEN.trimEnd())).toBe(true);
  });

  it('still writes monomind guidance, confined to its own managed block', async () => {
    writeFileSync(agentsMdPath, HAND_WRITTEN);

    await writeOpencodeFiles(projectDir, forceOptions(), freshResult());

    const after = readFileSync(agentsMdPath, 'utf-8');
    expect(after).toContain('<!-- monomind-block:agents-md -->');
    expect(after).toContain('<!-- /monomind-block:agents-md -->');
    expect(after).toContain(AGENTS_MD_SIGNATURE);
  });

  it('grows the file instead of replacing it (negative control for the raw overwrite)', async () => {
    writeFileSync(agentsMdPath, HAND_WRITTEN);

    await writeOpencodeFiles(projectDir, forceOptions(), freshResult());

    const after = readFileSync(agentsMdPath, 'utf-8');
    // The buggy behavior produced exactly generateAgentsMd()'s output.
    expect(after).not.toBe(generateAgentsMd());
    expect(after.length).toBeGreaterThan(HAND_WRITTEN.length);
  });

  it('refreshes the managed block in place on a second --force, without duplicating it', async () => {
    writeFileSync(agentsMdPath, HAND_WRITTEN);
    await writeOpencodeFiles(projectDir, forceOptions(), freshResult());
    const afterFirst = readFileSync(agentsMdPath, 'utf-8');

    // Make the block look like an older monomind version generated it.
    writeFileSync(
      agentsMdPath,
      afterFirst.replace(
        '## Code navigation — graph first',
        '## STALE SECTION FROM AN OLD VERSION',
      ),
    );

    await writeOpencodeFiles(projectDir, forceOptions(), freshResult());
    const afterSecond = readFileSync(agentsMdPath, 'utf-8');

    expect(afterSecond).toContain('## Code navigation — graph first');
    expect(afterSecond).not.toContain('STALE SECTION FROM AN OLD VERSION');
    expect(afterSecond).toContain('Full agent guidance for this repository.');
    expect(afterSecond.split(AGENTS_MD_SIGNATURE).length - 1).toBe(1);
    expect(afterSecond.split('<!-- monomind-block:agents-md -->').length - 1).toBe(1);
    expect(afterSecond).toBe(afterFirst);
  });

  it('does not append a second copy beside an unmarked monomind-generated body', async () => {
    // What a pre-marker release left behind: monomind's own body, unwrapped.
    writeFileSync(agentsMdPath, generateAgentsMd());
    const result = freshResult();

    await writeOpencodeFiles(projectDir, forceOptions(), result);

    const after = readFileSync(agentsMdPath, 'utf-8');
    expect(after.split(AGENTS_MD_SIGNATURE).length - 1).toBe(1);
    expect(after).toBe(generateAgentsMd());
    expect(result.skipped.some((entry) => entry.startsWith('AGENTS.md ('))).toBe(true);
  });

  it('does not touch the file without --force when it already exists (regression guard)', async () => {
    writeFileSync(agentsMdPath, HAND_WRITTEN);
    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: false,
      components: { ...DEFAULT_INIT_OPTIONS.components, opencode: true },
    };

    await writeOpencodeFiles(projectDir, options, freshResult());

    expect(readFileSync(agentsMdPath, 'utf-8')).toBe(HAND_WRITTEN);
  });

  it('writes a fresh AGENTS.md already wrapped in the managed block', async () => {
    await writeOpencodeFiles(projectDir, forceOptions(), freshResult());

    const content = readFileSync(agentsMdPath, 'utf-8');
    expect(content).toContain('<!-- monomind-block:agents-md -->');
    expect(content).toContain('<!-- /monomind-block:agents-md -->');
    expect(content).toContain(AGENTS_MD_SIGNATURE);
  });
});
