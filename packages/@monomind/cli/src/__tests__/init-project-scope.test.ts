import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shouldRegisterMonomindProject } from '../init/executor.js';
import { DEFAULT_INIT_OPTIONS, type InitResult } from '../init/types.js';
import { writeGeminiFiles } from '../init/write-antigravity.js';
import { writeKimiFiles } from '../init/write-kimicode.js';
import { writeOpencodeFiles } from '../init/write-opencode.js';

function emptyResult(): InitResult {
  return {
    success: true,
    platform: {} as InitResult['platform'],
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

describe('project-scope init writers', () => {
  const directories: string[] = [];
  const priorHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = priorHome;
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not mutate existing user Antigravity or Kimi settings during project init', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-project-init-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-project-home-'));
    directories.push(project, home);
    process.env.HOME = home;

    const agySettings = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
    const kimiTui = path.join(home, '.kimi-code', 'tui.toml');
    fs.mkdirSync(path.dirname(agySettings), { recursive: true });
    fs.mkdirSync(path.dirname(kimiTui), { recursive: true });
    fs.writeFileSync(agySettings, '{"statusLine":{"command":"user-owns-this"}}\n');
    fs.writeFileSync(kimiTui, '[status_line]\ncommand = "user-owns-this"\n');

    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: project,
      force: false,
      components: { ...DEFAULT_INIT_OPTIONS.components },
    };
    const result = emptyResult();
    await writeGeminiFiles(project, options, result);
    await writeKimiFiles(project, options, result);

    expect(fs.readFileSync(agySettings, 'utf8')).toBe(
      '{"statusLine":{"command":"user-owns-this"}}\n',
    );
    expect(fs.existsSync(path.join(home, '.gemini', 'antigravity-cli', 'statusline.sh'))).toBe(
      false,
    );
    expect(fs.readFileSync(kimiTui, 'utf8')).toBe('[status_line]\ncommand = "user-owns-this"\n');
    expect(fs.existsSync(path.join(home, '.kimi-code', 'statusline.sh'))).toBe(false);
    expect(result.created.files.some((file) => file.startsWith('~/'))).toBe(false);
  });

  it('does not register an isolated worktree as a separate project', () => {
    expect(shouldRegisterMonomindProject('/projects/app')).toBe(true);
    expect(shouldRegisterMonomindProject('/projects/app/.worktrees/platform-parity')).toBe(false);
  });

  it('sweeps stale .kimi-code/plugin/commands and .kimi-code/skills entries once the source command is removed', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-kimi-sweep-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-kimi-sweep-home-'));
    directories.push(project, home);
    process.env.HOME = home;

    const commandsDir = path.join(project, '.claude', 'commands', 'mastermind');
    fs.mkdirSync(commandsDir, { recursive: true });
    const commandPath = path.join(commandsDir, 'taskfile.md');
    fs.writeFileSync(commandPath, '---\ndescription: task file\n---\n\nBody.\n');

    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: project,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components },
    };

    // First run: the source command exists, so both kimi mirrors get generated.
    await writeKimiFiles(project, options, emptyResult());

    const pluginCommandPath = path.join(
      project,
      '.kimi-code',
      'plugin',
      'commands',
      'mastermind-taskfile.md',
    );
    const flowSkillDir = path.join(project, '.kimi-code', 'skills', 'mastermind-taskfile');
    expect(fs.existsSync(pluginCommandPath)).toBe(true);
    expect(fs.existsSync(flowSkillDir)).toBe(true);

    // Source command removed upstream (renamed or dropped in a newer version).
    fs.rmSync(commandPath);

    // Second --force run must sweep the now-stale kimi mirror, not leave it
    // behind forever (the class of bug proven live by
    // .kimi-code/plugin/commands/monomind-monomind-monomind-monoswarm-monoswarm.md
    // surviving multiple regenerations).
    await writeKimiFiles(project, options, emptyResult());

    expect(fs.existsSync(pluginCommandPath)).toBe(false);
    expect(fs.existsSync(flowSkillDir)).toBe(false);
  });

  it('refuses to write opencode commands through a .opencode/command symlink that resolves into .claude/commands', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-opencode-symlink-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-opencode-symlink-home-'));
    directories.push(project, home);
    process.env.HOME = home;

    // Nested command with no frontmatter at all — matches the live corruption:
    // .claude/commands/mastermind/adr.md has no `---` block, so the converter's
    // "add a description if absent" branch fires.
    const commandsDir = path.join(project, '.claude', 'commands', 'mastermind');
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, 'adr.md'), 'Draft an ADR.\n');

    // Reproduce the committed repo layout: .opencode/command is a symlink
    // into .claude/commands, not a directory of its own.
    fs.mkdirSync(path.join(project, '.opencode'), { recursive: true });
    fs.symlinkSync(
      path.join('..', '.claude', 'commands'),
      path.join(project, '.opencode', 'command'),
    );

    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: project,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components, opencode: true },
    };
    const result = emptyResult();
    await writeOpencodeFiles(project, options, result);

    // Must NOT resurrect a flattened duplicate back inside .claude/commands —
    // that's the file-duplication bug that reappeared on every `--force` run
    // in the real repo (.claude/commands/mastermind-adr.md, with a synthesized
    // "description: mastermind adr command (monomind)").
    expect(fs.existsSync(path.join(project, '.claude', 'commands', 'mastermind-adr.md'))).toBe(
      false,
    );
    expect(result.errors.some((e) => e.includes('.opencode/command'))).toBe(true);
  });

  it('refuses to write opencode agents through a .opencode/agent symlink that resolves into .claude/agents', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-opencode-agent-symlink-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-opencode-agent-symlink-home-'));
    directories.push(project, home);
    process.env.HOME = home;

    const agentsDir = path.join(project, '.claude', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const agentPath = path.join(agentsDir, 'coder.md');
    const originalAgentContent = '---\nname: coder\ndescription: writes code\n---\n\nBody.\n';
    fs.writeFileSync(agentPath, originalAgentContent);

    fs.mkdirSync(path.join(project, '.opencode'), { recursive: true });
    fs.symlinkSync(path.join('..', '.claude', 'agents'), path.join(project, '.opencode', 'agent'));

    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: project,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components, opencode: true },
    };
    const result = emptyResult();
    await writeOpencodeFiles(project, options, result);

    // Must NOT silently inject opencode's `mode: subagent` frontmatter key
    // into the real, hand-authored Claude agent file via the symlink.
    expect(fs.readFileSync(agentPath, 'utf8')).toBe(originalAgentContent);
    expect(result.errors.some((e) => e.includes('.opencode/agent'))).toBe(true);
  });
});
