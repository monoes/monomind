/**
 * #418: upgrading a project from 2.21.0 must not leave the removed monoswarm
 * commands behind. The init manifest tracks only top-level entries, so single
 * files inside still-shipping category folders (`commands/coordination/
 * monoswarm-init.md`), their Kimi Code and OpenCode copies, and projects from
 * before the manifest were never swept. `retireRemovedFiles` retires each
 * listed file whose content some release shipped, keeps edited ones with a
 * warning, and refreshes unmodified stale READMEs.
 *
 * The old layout comes from `__tests__/fixtures/retired-418-layout.json` — the
 * files 2.21.0 shipped — with the Kimi Code / OpenCode / mirror copies derived
 * by the same converters `init` runs.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeInit } from '../init/executor.js';
import { retireRemovedFiles } from '../init/retired-files.js';
import { RETIRED_FILE_HASHES, STALE_README_HASHES } from '../init/retired-files-data.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { executeUpgrade } from '../init/upgrade.js';
import { convertClaudeTreeToKimi } from '../init/write-kimicode.js';
import { convertClaudeTreeToOpencode } from '../init/write-opencode.js';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OLD_LAYOUT: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(PKG, '__tests__', 'fixtures', 'retired-418-layout.json'), 'utf-8'),
);
const OLD_HELPERS: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(PKG, '__tests__', 'fixtures', 'retired-helpers.json'), 'utf-8'),
);
const SOURCE_CLAUDE = path.join(PKG, '.claude');
const EDITED = '.claude/commands/mastermind/topology.md';
const EDITED_OPENCODE = '.opencode/command/monoswarm-status.md';
const EDITED_README = '.claude/commands/workflows/README.md';

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

function write(root: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

/** A project as a 2.21.0 `init --all-platforms` left it; returns every retired path written. */
function seedOldProject(dir: string): string[] {
  const retired: string[] = [];
  for (const [rel, content] of Object.entries(OLD_LAYOUT)) {
    write(dir, rel, content);
    if (!(rel in STALE_README_HASHES)) retired.push(rel);
  }
  const skill = OLD_LAYOUT['.claude/skills/monoswarm/SKILL.md'];
  for (const rel of ['.agents/skills/monoswarm/SKILL.md', '.gemini/skills/monoswarm/SKILL.md']) {
    write(dir, rel, skill);
    retired.push(rel);
  }
  const claudeDir = path.join(dir, '.claude');
  const kimi = convertClaudeTreeToKimi(claudeDir);
  const derived: Array<[string, string]> = [
    ...[...kimi.agents].map(([f, c]): [string, string] => [`.kimi-code/agents/${f}`, c]),
    ...[...kimi.skills].map(([d, c]): [string, string] => [`.kimi-code/skills/${d}/SKILL.md`, c]),
    ...[...kimi.pluginCommands].map(([f, c]): [string, string] => [
      `.kimi-code/plugin/commands/${f}`,
      c,
    ]),
  ];
  const oc = convertClaudeTreeToOpencode(claudeDir);
  derived.push(
    ...[...oc.agents].map(([f, c]): [string, string] => [`.opencode/agent/${f}`, c]),
    ...[...oc.commands].map(([f, c]): [string, string] => [`.opencode/command/${f}`, c]),
    ...[...oc.skills].map(([d, c]): [string, string] => [`.opencode/skills/${d}/SKILL.md`, c]),
  );
  for (const [rel, content] of derived) {
    write(dir, rel, content);
    retired.push(rel);
  }
  return retired;
}

describe('retiring files 2.22.0 removed (#418)', () => {
  let tmp: string;
  let dir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-418-'));
    dir = path.join(tmp, 'project');
    fs.mkdirSync(dir);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('the fixture covers every file the review named, and every derived copy is listed', () => {
    const retired = seedOldProject(dir);
    for (const rel of [
      '.claude/commands/coordination/monoswarm-init.md',
      '.claude/commands/coordination/task-orchestrate.md',
      '.claude/commands/mastermind/monoswarm.md',
      '.claude/commands/mastermind/topology.md',
      '.claude/commands/optimization/auto-topology.md',
      '.claude/agents/templates/coordinator-monoswarm-init.md',
      '.kimi-code/plugin/commands/coordination-monoswarm-init.md',
      '.kimi-code/skills/coordination-monoswarm-init/SKILL.md',
      '.opencode/command/monoswarm-init.md',
    ]) {
      expect(retired).toContain(rel);
    }
    expect(retired.filter((r) => r.startsWith('.opencode/command/monoswarm-')).length).toBe(14);
    for (const rel of retired) expect(Object.keys(RETIRED_FILE_HASHES)).toContain(rel);
  });

  it('init --force retires every shipped copy, keeps edited ones, and refreshes stale READMEs', async () => {
    const retired = seedOldProject(dir);
    fs.appendFileSync(path.join(dir, EDITED), '\nMy own note.\n');
    fs.appendFileSync(path.join(dir, EDITED_OPENCODE), '\nMy own note.\n');
    fs.appendFileSync(path.join(dir, EDITED_README), '\nMy own note.\n');

    const result = await executeInit({
      ...DEFAULT_INIT_OPTIONS,
      targetDir: dir,
      force: true,
      interactive: false,
      deferDoctor: true,
      initMemory: false,
      components: {
        ...Object.fromEntries(Object.keys(DEFAULT_INIT_OPTIONS.components).map((k) => [k, false])),
        skills: true,
        commands: true,
        agents: true,
        opencode: true,
        kimicode: true,
      } as typeof DEFAULT_INIT_OPTIONS.components,
    });

    const kept = new Set([EDITED, EDITED_OPENCODE]);
    for (const rel of retired) {
      // The kept, edited topology.md is still in .claude, so this run's own
      // Kimi Code / OpenCode conversion writes fresh copies of it.
      if (kept.has(rel) || rel.includes('mastermind-topology')) continue;
      expect(fs.existsSync(path.join(dir, rel)), `${rel} should be retired`).toBe(false);
    }
    // Edited files stay, byte for byte, with a warning each.
    expect(fs.readFileSync(path.join(dir, EDITED), 'utf-8')).toContain('My own note.');
    expect(fs.readFileSync(path.join(dir, EDITED_OPENCODE), 'utf-8')).toContain('My own note.');
    const warnings = (result.warnings ?? []).join('\n');
    expect(warnings).toContain(EDITED);
    expect(warnings).toContain(EDITED_OPENCODE);

    // Retired files are moved, not deleted, and empty directories go.
    const backups = path.join(dir, '.monomind', 'backups');
    const runDir = fs.readdirSync(backups)[0];
    expect(
      fs.existsSync(
        path.join(
          backups,
          runDir,
          'retired',
          'files',
          '.claude/commands/coordination/monoswarm-init.md',
        ),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(dir, '.claude/commands/monoswarm'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.kimi-code/skills/monoswarm-init'))).toBe(false);

    // Unmodified stale READMEs now hold the current copy; the edited one is untouched.
    for (const rel of [
      '.claude/commands/coordination/README.md',
      '.claude/commands/monitoring/README.md',
    ]) {
      const now = fs.readFileSync(path.join(dir, rel), 'utf-8');
      expect(now).toBe(fs.readFileSync(path.join(SOURCE_CLAUDE, rel.slice(8)), 'utf-8'));
      expect(now).not.toMatch(/monoswarm/i);
    }
    expect(fs.readFileSync(path.join(dir, EDITED_README), 'utf-8')).toContain('My own note.');
  });

  it('retires an OpenCode copy an older converter wrote with different frontmatter', () => {
    const rel = '.opencode/command/monoswarm-init.md';
    const body = OLD_LAYOUT['.claude/commands/monoswarm/init.md'].replace(
      /^---\n[\s\S]*?\n---\n/,
      '',
    );
    write(dir, rel, `---\ndescription: written by an older converter\n---\n\n${body}`);
    const result = freshResult();
    retireRemovedFiles(dir, result, SOURCE_CLAUDE);
    expect(fs.existsSync(path.join(dir, rel))).toBe(false);
    expect(result.removed.join('\n')).toContain(rel);
  });

  it('never retires an edited .claude copy, even with a shipped body', () => {
    const rel = '.claude/commands/monoswarm/init.md';
    write(dir, rel, OLD_LAYOUT[rel].replace(/^description: .*$/m, 'description: mine'));
    const result = freshResult();
    retireRemovedFiles(dir, result, SOURCE_CLAUDE);
    expect(fs.existsSync(path.join(dir, rel))).toBe(true);
    expect((result.warnings ?? []).join('\n')).toContain(rel);
  });

  it('init upgrade retires them too', async () => {
    const retired = seedOldProject(dir);
    const result = await executeUpgrade(dir);
    for (const rel of retired) {
      expect(fs.existsSync(path.join(dir, rel)), `${rel} should be retired`).toBe(false);
    }
    expect(result.updated.join('\n')).toContain(
      '[retired] files/.claude/commands/mastermind/monoswarm.md',
    );
  });

  it('retires the intelligence.cjs and router.cjs helpers, in .claude and .gemini', () => {
    const rels = Object.keys(OLD_HELPERS);
    for (const rel of rels) {
      write(dir, rel, OLD_HELPERS[rel]);
      write(dir, rel.replace('.claude/', '.gemini/'), OLD_HELPERS[rel]);
    }
    write(dir, '.claude/helpers/hook-handler.cjs', '// kept\n');
    const result = freshResult();
    retireRemovedFiles(dir, result, SOURCE_CLAUDE);
    for (const rel of rels) {
      expect(fs.existsSync(path.join(dir, rel)), rel).toBe(false);
      expect(fs.existsSync(path.join(dir, rel.replace('.claude/', '.gemini/'))), rel).toBe(false);
    }
    expect(fs.existsSync(path.join(dir, '.claude/helpers/hook-handler.cjs'))).toBe(true);
    expect(result.removed.join('\n')).toContain('files/.claude/helpers/router.cjs');
  });

  it('keeps an edited helper with a helper-specific warning', () => {
    const rel = '.claude/helpers/router.cjs';
    write(dir, rel, `${OLD_HELPERS[rel]}\n// mine\n`);
    const result = freshResult();
    retireRemovedFiles(dir, result, SOURCE_CLAUDE);
    expect(fs.existsSync(path.join(dir, rel))).toBe(true);
    const warnings = (result.warnings ?? []).join('\n');
    expect(warnings).toContain(rel);
    expect(warnings).not.toContain('monoswarm');
  });

  it('init upgrade retires the helpers too', async () => {
    for (const rel of Object.keys(OLD_HELPERS)) write(dir, rel, OLD_HELPERS[rel]);
    await executeUpgrade(dir);
    for (const rel of Object.keys(OLD_HELPERS)) {
      expect(fs.existsSync(path.join(dir, rel)), rel).toBe(false);
    }
  });
});
