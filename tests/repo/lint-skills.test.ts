/**
 * scripts/lint-skills.mjs promises (in its header) to fail CI on any
 * `monomind <cmd>` reference that does not resolve to a real command. Until
 * 2026-09 it only ever WARNED — 1,098 warnings, among them ~100
 * `monomind hook …` lines in hooks-automation and ~60 `monomind pair …` lines
 * in pair-programming, commands that never existed — so shipped skills told
 * models to run them. It also scanned prose, flagging "monomind for teams".
 *
 * Commands are now resolved against the BUILT CLI's registry (names and
 * aliases), only code (fenced blocks and inline code spans) is scanned, and an
 * unknown top-level command is an error. An unknown SUBCOMMAND of a real
 * command (`monomind performance optimize`, `monomind task retry`) was still
 * only a warning, and 60 of them shipped in command files; it is an error too.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX_CHARS,
  descriptionTooLong,
  extractCommandRefs,
  loadCliCommands,
  unresolvedReason,
} from '../../scripts/lint-skills.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'lint-skills.mjs');
// Loading the built CLI's whole command registry takes ~3s alone and over 30s when the full suite
// shares the CPUs; the tests that load it get a bound that load cannot reach.
const CLI_LOAD_TIMEOUT_MS = 180_000;

describe('lint-skills command references', () => {
  it('extracts commands in command position from code, not prose or prose inside code', () => {
    const md = [
      'Use monomind for teams and monomind does the rest.',
      '',
      '```bash',
      'npx monomind@latest hooks pre-edit --file x # monomind comment is ignored',
      '  monomind memory search -q "auth"',
      'echo "(not available — is monomind installed?)"',
      '  description: "Claude Code project with monomind integration",',
      'Bash("npx monomind@latest session restore --latest")',
      'cd app && npx -y monomind org run dev',
      '```',
      '',
      'Run `monomind doctor --fix` or `npx -y monomind pick -t "x"`.',
      'Not a command: `.monomind/config.json`, `@monoes/monomind`, `monomind-foo`.',
    ].join('\n');

    expect(extractCommandRefs(md).map((r) => [r.command, r.sub])).toEqual([
      ['hooks', 'pre-edit'],
      ['memory', 'search'],
      ['session', 'restore'],
      ['org', 'run'],
      ['doctor', undefined],
      ['pick', undefined],
    ]);
  });

  it(
    'resolves commands, aliases and subcommands from the built CLI',
    async () => {
      const cli = await loadCliCommands(REPO_ROOT);
      expect(cli.has('hooks')).toBe(true);
      expect(cli.has('kg')).toBe(true); // alias of monograph
      expect(cli.has('hook')).toBe(false);
      expect(cli.has('pair')).toBe(false);
      expect(cli.has('workflow')).toBe(false);
      expect(cli.get('hooks')?.has('pre-edit')).toBe(true);
      expect(cli.get('memory')?.has('get')).toBe(true); // subcommand alias
    },
    CLI_LOAD_TIMEOUT_MS,
  );

  it(
    'rejects unknown commands and unknown subcommands of commands that have them',
    async () => {
      const cli = await loadCliCommands(REPO_ROOT);
      const reason = (text: string) => {
        const [ref] = extractCommandRefs(`\`${text}\``);
        return unresolvedReason(ref, cli);
      };
      expect(reason('monomind hooks pre-edit')).toBeNull();
      expect(reason('monomind memory get')).toBeNull(); // subcommand alias
      expect(reason('monomind performance')).toBeNull();
      expect(reason('monomind pick something')).toBeNull(); // no subcommands: positional
      expect(reason('monomind hook pre-edit')).toMatch(/not a command of the built CLI/);
      expect(reason('monomind performance optimize')).toMatch(
        /'optimize' is not a subcommand of 'monomind performance'/,
      );
      expect(reason('npx monomind task retry --id x')).toMatch(/'retry' is not a subcommand/);
    },
    CLI_LOAD_TIMEOUT_MS,
  );

  it(
    'passes on the repo with zero unresolved commands or subcommands',
    () => {
      const run = spawnSync('node', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
      expect(run.stderr).not.toMatch(/not a command of the built CLI/);
      expect(run.stdout + run.stderr).not.toMatch(/not a subcommand of/);
      expect(run.status).toBe(0);
    },
    CLI_LOAD_TIMEOUT_MS,
  );
});

// GH #411: Claude Code drops descriptions once the skill/command listing passes
// ~1% of the context window, so a shipped description may not exceed the cap.
describe('lint-skills description cap', () => {
  const md = (fm: string) => `---\nname: x\n${fm}\n---\n\n# X\n`;

  it('flags a description over the cap and passes one at it', () => {
    expect(DESCRIPTION_MAX_CHARS).toBe(200);
    expect(descriptionTooLong(md(`description: "${'a'.repeat(200)}"`))).toBeNull();
    expect(descriptionTooLong(md(`description: "${'a'.repeat(201)}"`))).toMatch(
      /description is 201 chars \(max 200\)/,
    );
  });

  it('measures folded descriptions and a skill’s when_to_use', () => {
    const folded = md(`description: >\n  ${'word '.repeat(30)}\n  ${'word '.repeat(15)}`);
    expect(descriptionTooLong(folded)).toMatch(/description is 22\d chars/);
    const withWhen = md(`description: "${'a'.repeat(150)}"\nwhen_to_use: "${'b'.repeat(60)}"`);
    expect(descriptionTooLong(withWhen)).toBeNull();
    expect(descriptionTooLong(withWhen, { skill: true })).toMatch(/211 chars/);
  });

  it('ignores a file without frontmatter', () => {
    expect(descriptionTooLong('# Just a heading\n')).toBeNull();
  });
});
