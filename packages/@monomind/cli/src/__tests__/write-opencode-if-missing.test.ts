/**
 * `init --if-missing` must never write over a file that already exists. The
 * converted `.opencode/{agent,command,skills}` mirror used to be rewritten
 * unconditionally, discarding hand edits.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { finalizeGuard } from '../init/file-guard.js';
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

const EDIT = 'my hand-written version\n';

let targetDir: string;
beforeEach(() => {
  targetDir = mkdtempSync(join(tmpdir(), 'monomind-opencode-ifmissing-'));
  const claude = join(targetDir, '.claude');
  mkdirSync(join(claude, 'agents'), { recursive: true });
  mkdirSync(join(claude, 'commands', 'monomind'), { recursive: true });
  mkdirSync(join(claude, 'skills', 'tool'), { recursive: true });
  writeFileSync(
    join(claude, 'agents', 'coder.md'),
    '---\nname: coder\ndescription: codes\n---\n\nbody\n',
  );
  writeFileSync(
    join(claude, 'commands', 'monomind', 'ship.md'),
    '---\ndescription: ship\n---\n\nship it\n',
  );
  writeFileSync(
    join(claude, 'skills', 'tool', 'SKILL.md'),
    '---\nname: tool\ndescription: a tool\n---\n\nbody\n',
  );
});
afterEach(() => rmSync(targetDir, { recursive: true, force: true }));

const run = async (ifMissing: boolean): Promise<InitResult> => {
  const result = freshResult();
  await writeOpencodeFiles(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir, ifMissing }, result);
  finalizeGuard(result);
  return result;
};

const agent = () => join(targetDir, '.opencode', 'agent', 'coder.md');
const command = () => join(targetDir, '.opencode', 'command', 'monomind-ship.md');
const skill = () => join(targetDir, '.opencode', 'skills', 'tool', 'SKILL.md');

describe('opencode mirror under --if-missing', () => {
  it('leaves edited agent, command and skill files alone and reports them skipped', async () => {
    await run(false);
    for (const f of [agent(), command(), skill()]) writeFileSync(f, EDIT);

    const result = await run(true);

    for (const f of [agent(), command(), skill()]) expect(readFileSync(f, 'utf-8')).toBe(EDIT);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        '.opencode/agent/coder.md',
        '.opencode/command/monomind-ship.md',
        '.opencode/skills/tool/SKILL.md',
      ]),
    );
    expect(result.created.files.filter((f) => f.startsWith('.opencode/agent/'))).toEqual([]);
    expect(existsSync(`${agent()}.monomind-new`)).toBe(false);
  });

  it('still creates files that are missing', async () => {
    const result = await run(true);

    expect(existsSync(agent())).toBe(true);
    expect(existsSync(command())).toBe(true);
    expect(existsSync(skill())).toBe(true);
    expect(result.created.files).toContain('.opencode/agent/ (1 agents)');
  });

  it('regenerates the mirror without --if-missing', async () => {
    await run(false);
    writeFileSync(agent(), EDIT);

    await run(false);

    expect(readFileSync(agent(), 'utf-8')).not.toBe(EDIT);
  });
});
