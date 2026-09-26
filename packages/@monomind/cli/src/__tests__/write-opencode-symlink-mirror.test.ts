/**
 * A repo may symlink `.opencode/{agent,command,skills}` to the matching
 * `.claude/` directory on purpose (this one does). The converter must still
 * skip writing through such a link, but that setup is not worth a warning on
 * every init; a link resolving anywhere else inside `.claude/` still is.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

const AGENT = '---\nname: helper\ndescription: helps\n---\n\nbody\n';
const SKILL = '---\nname: tool\ndescription: a tool\n---\n\nbody\n';

let targetDir: string;
beforeEach(() => {
  targetDir = mkdtempSync(join(tmpdir(), 'monomind-opencode-symlink-'));
  const claude = join(targetDir, '.claude');
  mkdirSync(join(claude, 'agents'), { recursive: true });
  mkdirSync(join(claude, 'commands'), { recursive: true });
  mkdirSync(join(claude, 'skills', 'tool'), { recursive: true });
  writeFileSync(join(claude, 'agents', 'helper.md'), AGENT);
  writeFileSync(join(claude, 'skills', 'tool', 'SKILL.md'), SKILL);
  mkdirSync(join(targetDir, '.opencode'));
});
afterEach(() => rmSync(targetDir, { recursive: true, force: true }));

const run = async (): Promise<InitResult> => {
  const result = freshResult();
  await writeOpencodeFiles(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir }, result);
  return result;
};

describe('opencode symlinks into .claude/', () => {
  it('skips a link to the matching .claude directory without a warning', async () => {
    symlinkSync('../.claude/agents', join(targetDir, '.opencode', 'agent'));
    symlinkSync('../.claude/commands', join(targetDir, '.opencode', 'command'));
    symlinkSync('../.claude/skills', join(targetDir, '.opencode', 'skills'));

    const result = await run();

    expect(result.errors.filter((e) => e.includes('resolves inside'))).toEqual([]);
    expect(readFileSync(join(targetDir, '.claude', 'agents', 'helper.md'), 'utf-8')).toBe(AGENT);
    expect(readFileSync(join(targetDir, '.claude', 'skills', 'tool', 'SKILL.md'), 'utf-8')).toBe(
      SKILL,
    );
  });

  it('still warns about a link to any other place inside .claude/', async () => {
    symlinkSync('../.claude/skills', join(targetDir, '.opencode', 'agent'));

    const result = await run();

    expect(result.errors.filter((e) => e.includes('resolves inside'))).toEqual([
      expect.stringContaining('.opencode/agent resolves inside .claude/'),
    ]);
    expect(readFileSync(join(targetDir, '.claude', 'skills', 'tool', 'SKILL.md'), 'utf-8')).toBe(
      SKILL,
    );
  });
});
