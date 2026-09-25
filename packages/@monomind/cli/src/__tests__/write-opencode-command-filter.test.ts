/**
 * The opencode converter turned every `.claude/commands` markdown file except
 * READMEs into an opencode command — including shared includes other commands
 * read (`mastermind/_repeat.md`, `_taskfile.md`) and platform notes under
 * `references/`. `_repeat.md` also slugified to the same file as the real
 * `repeat.md`, so whichever the walk returned last won.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
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
  targetDir = mkdtempSync(join(tmpdir(), 'monomind-opencode-commands-'));
});
afterEach(() => rmSync(targetDir, { recursive: true, force: true }));

describe('opencode command conversion', () => {
  it('converts only invocable commands', async () => {
    const commands = join(targetDir, '.claude', 'commands');
    mkdirSync(join(commands, 'mastermind', 'references'), { recursive: true });
    const command = (body: string) => `---\ndescription: ${body}\n---\n\n${body}\n`;
    writeFileSync(join(commands, 'mastermind', 'repeat.md'), command('REAL REPEAT'));
    writeFileSync(join(commands, 'mastermind', '_repeat.md'), command('INCLUDE REPEAT'));
    writeFileSync(join(commands, 'mastermind', '_taskfile.md'), command('INCLUDE TASKFILE'));
    writeFileSync(join(commands, 'mastermind', 'README.md'), command('README'));
    writeFileSync(join(commands, 'mastermind', 'references', 'codex-tools.md'), command('NOTES'));
    writeFileSync(join(commands, 'mastermind', 'plan.md'), command('PLAN'));

    await writeOpencodeFiles(
      targetDir,
      { ...DEFAULT_INIT_OPTIONS, targetDir, force: false },
      freshResult(),
    );

    const out = join(targetDir, '.opencode', 'command');
    const all = readdirSync(out)
      .map((name) => readFileSync(join(out, name), 'utf-8'))
      .join('\n');
    expect(all).toContain('REAL REPEAT');
    expect(all).toContain('PLAN');
    for (const excluded of ['INCLUDE REPEAT', 'INCLUDE TASKFILE', 'NOTES', 'README'])
      expect(all, excluded).not.toContain(excluded);
  });
});
