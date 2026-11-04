import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateCodexAgentsMd } from '../init/codex-generator.js';
import { generateKimiAgentsMd } from '../init/kimi-generator.js';
import { generateAgentsMd } from '../init/opencode-generator.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeAgentsMd } from '../init/write-agents.js';
import { writeCodexFiles } from '../init/write-codex.js';
import { writeKimiFiles } from '../init/write-kimicode.js';
import { writeOpencodeFiles } from '../init/write-opencode.js';

// The title line generateAgentsMd() stamps on monomind's own body — counting
// it is how these tests check there is exactly one copy in the file.
const GENERATED_TITLE = '# AGENTS.md — Monomind on opencode';

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
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

describe('opencode AGENTS.md block preserves project-owned content (GH #278)', () => {
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

    await writeAgentsMd(projectDir, forceOptions(), freshResult());

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

    await writeAgentsMd(projectDir, forceOptions(), freshResult());

    const after = readFileSync(agentsMdPath, 'utf-8');
    expect(after).toContain('<!-- monomind-block:agents-md -->');
    expect(after).toContain('<!-- /monomind-block:agents-md -->');
    expect(after).toContain(GENERATED_TITLE);
  });

  it('grows the file instead of replacing it (negative control for the raw overwrite)', async () => {
    writeFileSync(agentsMdPath, HAND_WRITTEN);

    await writeAgentsMd(projectDir, forceOptions(), freshResult());

    const after = readFileSync(agentsMdPath, 'utf-8');
    // The buggy behavior produced exactly generateAgentsMd()'s output.
    expect(after).not.toBe(generateAgentsMd());
    expect(after.length).toBeGreaterThan(HAND_WRITTEN.length);
  });

  it('refreshes the managed block in place on a second --force, without duplicating it', async () => {
    writeFileSync(agentsMdPath, HAND_WRITTEN);
    await writeAgentsMd(projectDir, forceOptions(), freshResult());
    const afterFirst = readFileSync(agentsMdPath, 'utf-8');

    // Make the block look like an older monomind version generated it.
    writeFileSync(
      agentsMdPath,
      afterFirst.replace(
        '## Code navigation — graph first',
        '## STALE SECTION FROM AN OLD VERSION',
      ),
    );

    await writeAgentsMd(projectDir, forceOptions(), freshResult());
    const afterSecond = readFileSync(agentsMdPath, 'utf-8');

    expect(afterSecond).toContain('## Code navigation — graph first');
    expect(afterSecond).not.toContain('STALE SECTION FROM AN OLD VERSION');
    expect(afterSecond).toContain('Full agent guidance for this repository.');
    expect(afterSecond.split(GENERATED_TITLE).length - 1).toBe(1);
    expect(afterSecond.split('<!-- monomind-block:agents-md -->').length - 1).toBe(1);
    expect(afterSecond).toBe(afterFirst);
  });

  it('migrates an unmarked monomind-generated body in place rather than duplicating it', async () => {
    // What a pre-delimiter release left behind: monomind's own body, unwrapped,
    // under the project's own heading. mergeGeneratedBlock replaces that region
    // (GH #276) instead of appending a second complete copy beside it.
    const preamble = '# AGENTS.md — mono-agent\n\nProject preamble the user wrote.\n\n';
    writeFileSync(agentsMdPath, `${preamble}${generateAgentsMd()}`);

    await writeAgentsMd(projectDir, forceOptions(), freshResult());

    const after = readFileSync(agentsMdPath, 'utf-8');
    expect(after.split(GENERATED_TITLE).length - 1).toBe(1);
    expect(after.split('<!-- monomind-block:agents-md -->').length - 1).toBe(1);
    expect(after).toContain('Project preamble the user wrote.');
  });

  it('does not touch the file without --force when it already exists (regression guard)', async () => {
    writeFileSync(agentsMdPath, HAND_WRITTEN);
    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: false,
      components: { ...DEFAULT_INIT_OPTIONS.components, opencode: true },
    };

    await writeAgentsMd(projectDir, options, freshResult());

    expect(readFileSync(agentsMdPath, 'utf-8')).toBe(HAND_WRITTEN);
  });

  it('writes a fresh AGENTS.md already wrapped in the managed block', async () => {
    await writeAgentsMd(projectDir, forceOptions(), freshResult());

    const content = readFileSync(agentsMdPath, 'utf-8');
    expect(content).toContain('<!-- monomind-block:agents-md -->');
    expect(content).toContain('<!-- /monomind-block:agents-md -->');
    expect(content).toContain(GENERATED_TITLE);
  });
});

// Four init writers used to write AGENTS.md (codex, opencode, kimi: two
// skip-if-exists, one managed block under --force), so which body won
// depended on write order. writeAgentsMd is now the one writer: one managed
// block per selected runtime, always written in the same order.
describe('AGENTS.md has one owner (writeAgentsMd)', () => {
  let projectDir: string;
  let agentsMdPath: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'monomind-agents-md-owner-'));
    agentsMdPath = join(projectDir, 'AGENTS.md');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const TITLES = [
    '# AGENTS.md — Monomind on Codex',
    '# AGENTS.md — Monomind on opencode',
    '# AGENTS.md — Monomind on Kimi Code',
  ];
  const count = (text: string, needle: string) => text.split(needle).length - 1;

  function allThree(force: boolean) {
    return {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force,
      components: {
        ...DEFAULT_INIT_OPTIONS.components,
        codex: true,
        opencode: true,
        kimicode: true,
      },
    };
  }

  it('the per-runtime writers no longer write AGENTS.md themselves', async () => {
    const options = allThree(true);
    await writeCodexFiles(projectDir, options, freshResult());
    await writeOpencodeFiles(projectDir, options, freshResult());
    await writeKimiFiles(projectDir, options, freshResult());
    expect(existsSync(agentsMdPath)).toBe(false);
  });

  it('writes one block per selected runtime, in a fixed order', () => {
    const result = freshResult();
    writeAgentsMd(projectDir, allThree(false), result);

    const text = readFileSync(agentsMdPath, 'utf-8');
    for (const title of TITLES) expect(count(text, title)).toBe(1);
    const markers = ['agents-md:codex', 'agents-md', 'agents-md:kimi'];
    for (const marker of markers) expect(count(text, `<!-- monomind-block:${marker} -->`)).toBe(1);
    const positions = markers.map((marker) => text.indexOf(`<!-- monomind-block:${marker} -->`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(result.created.files).toEqual(['AGENTS.md']);
  });

  it('is byte-identical on a re-run, with and without --force', () => {
    writeAgentsMd(projectDir, allThree(false), freshResult());
    const first = readFileSync(agentsMdPath, 'utf-8');
    writeAgentsMd(projectDir, allThree(true), freshResult());
    expect(readFileSync(agentsMdPath, 'utf-8')).toBe(first);
    const result = freshResult();
    writeAgentsMd(projectDir, allThree(false), result);
    expect(readFileSync(agentsMdPath, 'utf-8')).toBe(first);
    expect(result.skipped).toContain('AGENTS.md');
  });

  it('heals a file an older skip-if-exists writer left unmarked, one copy per runtime', () => {
    // Codex won the race in an older release: its body, unwrapped.
    writeFileSync(agentsMdPath, `# Project\n\nOur notes.\n\n${generateCodexAgentsMd()}`);
    writeAgentsMd(projectDir, allThree(true), freshResult());
    const healed = readFileSync(agentsMdPath, 'utf-8');
    for (const title of TITLES) expect(count(healed, title)).toBe(1);
    expect(healed.startsWith('# Project\n\nOur notes.')).toBe(true);

    // Kimi won it instead: same blocks, same order, whatever wrote first.
    writeFileSync(agentsMdPath, `# Project\n\nOur notes.\n\n${generateKimiAgentsMd()}`);
    writeAgentsMd(projectDir, allThree(true), freshResult());
    const other = readFileSync(agentsMdPath, 'utf-8');
    for (const title of TITLES) expect(count(other, title)).toBe(1);
    expect(other.replace(/\n+/g, '\n')).toBe(healed.replace(/\n+/g, '\n'));
  });

  it('writes nothing when no AGENTS.md runtime is selected', () => {
    writeAgentsMd(projectDir, { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir }, freshResult());
    expect(existsSync(agentsMdPath)).toBe(false);
  });
});
