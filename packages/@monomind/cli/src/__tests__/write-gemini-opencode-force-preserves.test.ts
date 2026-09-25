/**
 * `init --force` rewrote GEMINI.md and opencode.json wholesale, destroying
 * project guidance and config the user had added. GEMINI.md now uses the same
 * managed block as CLAUDE.md; opencode.json is merged key by key.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateGeminiMd } from '../init/geminimd-generator.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeGeminiFiles } from '../init/write-antigravity.js';
import { writeOpencodeFiles } from '../init/write-opencode.js';

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

let targetDir: string;
beforeEach(() => {
  targetDir = mkdtempSync(join(tmpdir(), 'monomind-gemini-opencode-'));
});
afterEach(() => rmSync(targetDir, { recursive: true, force: true }));

const options = (force: boolean) => ({
  ...DEFAULT_INIT_OPTIONS,
  targetDir,
  force,
  components: { ...DEFAULT_INIT_OPTIONS.components, helpers: true },
});

describe('GEMINI.md under --force', () => {
  it('keeps text outside the managed block', async () => {
    await writeGeminiFiles(targetDir, options(false), freshResult());
    const geminiPath = join(targetDir, 'GEMINI.md');
    const first = readFileSync(geminiPath, 'utf-8');
    expect(first).toContain('<!-- monomind-block:gemini-md -->');
    writeFileSync(
      geminiPath,
      `# Our project\n\nUse tabs.\n\n${first}\n## Team notes\nShip on Fridays.\n`,
    );

    await writeGeminiFiles(targetDir, options(true), freshResult());

    const after = readFileSync(geminiPath, 'utf-8');
    expect(after).toContain('# Our project\n\nUse tabs.');
    expect(after).toContain('## Team notes\nShip on Fridays.');
    expect(after.match(/<!-- monomind-block:gemini-md -->/g)).toHaveLength(1);
  });

  it('migrates a body written before the block existed instead of duplicating it', async () => {
    const geminiPath = join(targetDir, 'GEMINI.md');
    const legacyBody = generateGeminiMd(options(false));
    writeFileSync(geminiPath, `${legacyBody}\n## Team notes\nShip on Fridays.\n`);

    await writeGeminiFiles(targetDir, options(true), freshResult());

    const after = readFileSync(geminiPath, 'utf-8');
    const title = legacyBody.split('\n')[0];
    expect(after.split('\n').filter((line) => line === title)).toHaveLength(1);
    expect(after).toContain('## Team notes\nShip on Fridays.');
  });
});

describe('opencode.json under --force', () => {
  it('keeps user keys and values and refreshes only what is missing', async () => {
    await writeOpencodeFiles(targetDir, options(false), freshResult());
    const jsonPath = join(targetDir, 'opencode.json');
    const first = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    first.theme = 'dracula';
    first.mcp.github = { type: 'local', command: ['gh-mcp'] };
    first.mcp.monomind.env.MY_VAR = 'mine';
    first.permission.bash['git *'] = 'allow';
    first.instructions.push('docs/STYLE.md');
    delete first.permission.read;
    writeFileSync(jsonPath, JSON.stringify(first, null, 2));

    await writeOpencodeFiles(targetDir, options(true), freshResult());

    const after = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    expect(after.theme).toBe('dracula');
    expect(after.mcp.github).toEqual({ type: 'local', command: ['gh-mcp'] });
    expect(after.mcp.monomind.env.MY_VAR).toBe('mine');
    expect(after.permission.bash['git *']).toBe('allow');
    expect(after.instructions).toContain('docs/STYLE.md');
    expect(after.instructions.filter((i: string) => i === 'AGENTS.md')).toHaveLength(1);
    // A default section the user's file lacked comes back.
    expect(after.permission.read).toBeDefined();
  });
});
