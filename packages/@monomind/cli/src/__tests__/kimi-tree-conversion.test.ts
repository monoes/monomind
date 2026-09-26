import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INIT_OPTIONS, type InitResult } from '../init/types.js';
import {
  convertClaudeTreeToKimi,
  isConvertibleCommand,
  writeKimiFiles,
} from '../init/write-kimicode.js';

// Plugin command filenames and flow-skill names come from the same slug today,
// so the plugin-command collision check also catches every flow-skill
// collision. This switch lets a test give the two diverging names, to prove
// the flow-skill check reports a collision on its own (GH #342).
const kimiNames = vi.hoisted(() => ({ distinctPluginFiles: false }));
vi.mock('../init/kimi-generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../init/kimi-generator.js')>();
  return {
    ...actual,
    kimiCommandFilename: (category: string, file: string) =>
      kimiNames.distinctPluginFiles
        ? `${category}--${file}.md`
        : actual.kimiCommandFilename(category, file),
  };
});

function emptyResult(): InitResult {
  return {
    success: true,
    platform: {} as InitResult['platform'],
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('kimi command conversion', () => {
  const directories: string[] = [];
  const priorHome = process.env.HOME;

  afterEach(() => {
    kimiNames.distinctPluginFiles = false;
    process.env.HOME = priorHome;
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function tempProject(): string {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-kimi-tree-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-kimi-tree-home-'));
    directories.push(project, home);
    process.env.HOME = home;
    return project;
  }

  it('treats READMEs, _-prefixed includes and references/ files as non-commands', () => {
    expect(isConvertibleCommand(path.join('mastermind', 'plan.md'))).toBe(true);
    expect(isConvertibleCommand('ts.md')).toBe(true);
    expect(isConvertibleCommand(path.join('mastermind', '_repeat.md'))).toBe(false);
    expect(isConvertibleCommand(path.join('mastermind', '_taskfile.md'))).toBe(false);
    expect(isConvertibleCommand(path.join('hooks', 'README.md'))).toBe(false);
    expect(isConvertibleCommand(path.join('mastermind', 'references', 'codex-tools.md'))).toBe(
      false,
    );
  });

  it('does not let mastermind/_repeat.md clobber mastermind/repeat.md (filename collision)', async () => {
    const project = tempProject();
    writeFile(
      project,
      '.claude/commands/mastermind/repeat.md',
      '---\ndescription: the real repeat command\n---\n\nREAL\n',
    );
    writeFile(project, '.claude/commands/mastermind/_repeat.md', '<!-- include -->\n\nINCLUDE\n');
    writeFile(
      project,
      '.claude/commands/mastermind/references/codex-tools.md',
      '# Codex tools\n\nREFERENCE\n',
    );

    await writeKimiFiles(
      project,
      { ...DEFAULT_INIT_OPTIONS, targetDir: project, force: true },
      emptyResult(),
    );

    const pluginDir = path.join(project, '.kimi-code', 'plugin', 'commands');
    expect(fs.readFileSync(path.join(pluginDir, 'mastermind-repeat.md'), 'utf8')).toContain('REAL');
    expect(fs.readdirSync(pluginDir).sort()).toEqual(['mastermind-repeat.md']);
    expect(
      fs.existsSync(path.join(project, '.kimi-code', 'skills', 'mastermind-codex-tools')),
    ).toBe(false);
  });

  it('reports a genuine command filename collision instead of silently overwriting', () => {
    const project = tempProject();
    // Both slugify to "a-b-c"; "a-b/c.md" sorts before "a/b-c.md".
    writeFile(project, '.claude/commands/a/b-c.md', '---\ndescription: second\n---\n\nSECOND\n');
    writeFile(project, '.claude/commands/a-b/c.md', '---\ndescription: first\n---\n\nFIRST\n');

    const tree = convertClaudeTreeToKimi(path.join(project, '.claude'));

    expect([...tree.pluginCommands.keys()]).toEqual(['a-b-c.md']);
    // Deterministic: sorted source order, first one wins.
    expect(tree.pluginCommands.get('a-b-c.md')).toContain('FIRST');
    expect(tree.skipped.some((s) => s.includes('a/b-c.md') && s.includes('collides'))).toBe(true);
  });

  it('reports a command flow-skill name collision instead of silently dropping it', () => {
    const project = tempProject();
    kimiNames.distinctPluginFiles = true;
    // Both flow skills are named "a-b-c"; "a-b/c.md" sorts before "a/b-c.md".
    writeFile(project, '.claude/commands/a/b-c.md', '---\ndescription: second\n---\n\nSECOND\n');
    writeFile(project, '.claude/commands/a-b/c.md', '---\ndescription: first\n---\n\nFIRST\n');

    const tree = convertClaudeTreeToKimi(path.join(project, '.claude'));

    expect([...tree.pluginCommands.keys()].sort()).toEqual(['a--b-c.md', 'a-b--c.md']);
    expect([...tree.skills.keys()]).toEqual(['a-b-c']);
    expect(tree.skills.get('a-b-c')).toContain('FIRST');
    expect(
      tree.skipped.some(
        (s) => s.includes('a/b-c.md') && s.includes('collides') && s.includes('skills/a-b-c/'),
      ),
    ).toBe(true);
  });

  it('produces agents, skills, flow skills and plugin commands in memory', () => {
    const project = tempProject();
    const claude = path.join(project, '.claude');
    writeFile(claude, 'agents/core/coder.md', '---\nname: coder\ndescription: codes\n---\n\nC\n');
    writeFile(claude, 'skills/foo/SKILL.md', '---\nname: foo\ndescription: foo skill\n---\n\nF\n');
    writeFile(claude, 'commands/bar/baz.md', '---\ndescription: baz\n---\n\nB\n');

    const tree = convertClaudeTreeToKimi(claude);

    expect([...tree.agents.keys()]).toEqual(['coder.md']);
    expect([...tree.skills.keys()].sort()).toEqual(['bar-baz', 'foo']);
    expect(tree.skills.get('bar-baz')).toMatch(/^type: flow$/m);
    expect([...tree.pluginCommands.keys()]).toEqual(['bar-baz.md']);
  });
});
