/**
 * scripts/lint-agent-refs.mjs fails when shipped text (including CLAUDE.md
 * agent rosters) names an agent or skill
 * that does not exist: `subagent_type: "backend-dev"` fails at spawn time and
 * `Skill("mastermind-do")` fails at load time (only the /mastermind:do
 * command exists). These tests pin the repo clean and pin what the lint
 * accepts and rejects on a fixture tree.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'lint-agent-refs.mjs');

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

describe('lint-agent-refs', () => {
  it('passes on the repo', () => {
    const out = execFileSync('node', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
    expect(out).toMatch(/passed — \d+ reference/);
  });

  describe('on a fixture tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'lint-agent-refs-'));
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    write(
      root,
      'packages/@monomind/cli/.claude/agents/core/coder.md',
      '---\nname: coder\n---\nbody\n',
    );
    write(
      root,
      'packages/@monomind/cli/.claude/agents/engineering/sec.md',
      '---\nname: Security Engineer\n---\nbody\n',
    );
    write(root, '.claude/skills/mastermind-review/SKILL.md', '---\nname: mastermind-review\n---\n');
    write(root, '.claude/commands/mastermind/do.md', 'do\n');
    // Converted command skill that only a platform tree carries.
    write(root, '.kimi-code/skills/mastermind-do/SKILL.md', 'Skill("mastermind-do")\n');
    write(
      root,
      '.claude/commands/good.md',
      [
        'Task({ subagent_type: "coder" })',
        '"subagent_type": "Security Engineer"',
        "subagent_type 'general-purpose'",
        'subagent_type: "<picked agent>"',
        'subagent_type: "Agent Name"',
        '`subagent_type` is the string value of the pick',
        'Skill("mastermind-review")',
        'Skill("mastermind:do", "--file x")',
        'Skill("loop")',
        'Skill("mastermind-<name>")',
      ].join('\n'),
    );
    write(
      root,
      '.claude/skills/bad/SKILL.md',
      'Task({ subagent_type: "backend-dev" })\nSkill("mastermind-do")\n',
    );
    write(
      root,
      'packages/@monomind/cli/src/gen.ts',
      "const x = { agentSlug: 'security-architect' };\n",
    );
    write(
      root,
      'packages/@monomind/cli/src/gen.test.ts',
      "const y = { agentSlug: 'not-scanned' };\n",
    );
    write(root, 'packages/@monomind/routing/src/r.ts', "const z = { agentSlug: 'excluded' };\n");
    // Prose rosters in CLAUDE.md: roster lines under an agents heading and the
    // last column of an agents table; other backticked text is not a name.
    write(
      root,
      'packages/@monomind/cli/CLAUDE.md',
      [
        '## Available Agents',
        '',
        '### Core',
        '`coder`, `security-architect`',
        '`Security Engineer` — security work.',
        '`src/utils/input-guards.ts` holds the guards',
        '',
        '| Code | Task | Agents |',
        '| ---- | ---- | ------ |',
        '| 1 | Bug Fix | coder, perf-engineer |',
        '',
        '## Commands',
        '`not-an-agent`',
      ].join('\n'),
    );

    // Init generator templates: escaped-backtick rosters and dash bullets
    // under an agents heading, checked like a CLAUDE.md.
    write(
      root,
      'packages/@monomind/cli/src/init/gen-md.ts',
      [
        'export const t = `',
        '## Performance Agents',
        '- \\`perf-analyzer\\` — bottleneck detection',
        '- \\`coder\\` — writes code',
        '- \\`npx monomind doctor\\` is a command, not a name',
        '`;',
      ].join('\n'),
    );
    // Quickref prose names agents too.
    write(
      root,
      'packages/@monomind/cli/src/quickref.ts',
      "const q = ['Use code-review-swarm agent for reviews', 'Use a registry agent'];\n",
    );
    // Hook helpers are scanned.
    write(root, '.claude/helpers/handlers/h.cjs', 'console.log(\'Skill("no-such-skill")\');\n');
    // A deprecated agent resolves, but is reported as a warning.
    write(
      root,
      'packages/@monomind/cli/.claude/agents/github/old-pr.md',
      '---\nname: old-pr\ndeprecated: true\ndeprecatedBy: coder\n---\nbody\n',
    );
    write(root, '.claude/commands/uses-old.md', 'Task({ subagent_type: "old-pr" })\n');

    const run = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });

    it('exits 1', () => {
      expect(run.status).toBe(1);
    });

    it('reports exactly the unknown names', () => {
      const bad = run.stderr
        .split('\n')
        .filter((l) => l.includes(': unknown '))
        .map((l) => l.trim());
      expect(bad).toEqual([
        'packages/@monomind/cli/CLAUDE.md:4: unknown agent "security-architect"',
        'packages/@monomind/cli/CLAUDE.md:10: unknown agent "perf-engineer"',
        'packages/@monomind/cli/src/init/gen-md.ts:3: unknown agent "perf-analyzer"',
        '.claude/skills/bad/SKILL.md:1: unknown agent "backend-dev"',
        '.claude/skills/bad/SKILL.md:2: unknown skill "mastermind-do"',
        'packages/@monomind/cli/src/gen.ts:1: unknown agent "security-architect"',
        'packages/@monomind/cli/src/quickref.ts:1: unknown agent "code-review-swarm"',
        '.claude/helpers/handlers/h.cjs:1: unknown skill "no-such-skill"',
      ]);
    });

    it('warns (without failing on it) about deprecated agents', () => {
      expect(run.stderr).toContain(
        '.claude/commands/uses-old.md:1: "old-pr" is deprecated (use "coder")',
      );
    });
  });
});
