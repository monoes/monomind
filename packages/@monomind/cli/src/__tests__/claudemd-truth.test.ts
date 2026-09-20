// i-041/i-117 — make the generated CLAUDE.md/CAPABILITIES.md tell the
// truth: `--wizard` is not a flag, the hook/worker counts were hardcoded and
// wrong in opposite directions (29/8 vs real 28/9), "(unavailable in this
// install)" was always shown (a require.resolve bug, not real unavailability),
// dead MONOMIND_* env vars were advertised, `hooks session-start` is
// deprecated, and `@latest` costs a registry round-trip on every invocation.
// Run over all six ClaudeMdTemplate variants plus writeCapabilitiesDoc output.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { hooksCommand } from '../commands/hooks.js';
import {
  _resetOptionalPackageCache,
  generateClaudeMd,
  HONEST_MONOSWARM_SENTENCE,
} from '../init/claudemd-generator.js';
import { WORKER_COUNT } from '../init/generated-counts.js';
import { generateMCPJson } from '../init/mcp-generator.js';
import { _isOptionalPackageResolvable } from '../init/shared.js';
import {
  type ClaudeMdTemplate,
  DEFAULT_INIT_OPTIONS,
  detectPlatform,
  type InitResult,
} from '../init/types.js';
import { writeCapabilitiesDoc } from '../init/write-capabilities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

const TEMPLATES: ClaudeMdTemplate[] = [
  'minimal',
  'standard',
  'full',
  'security',
  'performance',
  'solo',
];

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

async function generatedCapabilities(): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'monomind-claudemd-truth-'));
  try {
    const targetDir = join(tmp, 'project');
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    await writeCapabilitiesDoc(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir }, freshResult());
    return readFileSync(join(targetDir, '.monomind', 'CAPABILITIES.md'), 'utf-8');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function allTemplateDocs(): string[] {
  return TEMPLATES.map((tmpl) =>
    generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() }, tmpl),
  );
}

describe('claudemd-truth (i-041/i-117)', () => {
  describe('§1 — --wizard is not a flag', () => {
    it.each(TEMPLATES)('%s: no generated doc tells the user to run `init --wizard`', (tmpl) => {
      const generated = generateClaudeMd(
        { ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() },
        tmpl,
      );
      expect(generated).not.toMatch(/init --wizard/);
    });

    it('CAPABILITIES.md does not tell the user to run `init --wizard`', async () => {
      expect(await generatedCapabilities()).not.toMatch(/init --wizard/);
    });
  });

  describe('§2 — CLI-commands counts are derived, not hardcoded', () => {
    // hooksCommand.subcommands is a real array literal in commands/hooks.ts —
    // typed optional on Command generally, but known non-null here. Narrowed
    // once so the mutation test below can push/pop it directly.
    const hooksSubcommands = hooksCommand.subcommands;
    if (!hooksSubcommands) throw new Error('hooksCommand.subcommands must be defined');

    it('the hooks row equals hooksCommand.subcommands.length BY REFERENCE, not the literal 28', () => {
      // Asserting the literal 28 would be the same hardcoding one layer up
      // (plan's explicit trap). This must read the live array.
      const generated = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() });
      expect(generated).toContain(`\`hooks\` | ${hooksSubcommands.length}`);
      expect(generated).not.toContain('`hooks` | 29');
    });

    it('AC-4 — the count is ALIVE: mutating hooksCommand.subcommands changes the rendered number', () => {
      const before = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() });
      const beforeCount = hooksSubcommands.length;
      expect(before).toContain(`\`hooks\` | ${beforeCount}`);

      // Live mutation of the real Command object's subcommands array — not a
      // mock, not a different code path. If the generator re-hardcoded the
      // count, this would have no effect on its output.
      const scratchSubcommand = {
        name: '__scratch-probe__',
        description: 'test',
        action: async () => ({ success: true }),
      };
      hooksSubcommands.push(scratchSubcommand as (typeof hooksSubcommands)[number]);
      try {
        const after = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() });
        expect(after).toContain(`\`hooks\` | ${beforeCount + 1}`);
        expect(after).not.toContain(`\`hooks\` | ${beforeCount} `);
      } finally {
        hooksSubcommands.pop();
      }

      // Reverted: the count is back to what it was before the probe.
      const reverted = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() });
      expect(reverted).toContain(`\`hooks\` | ${beforeCount}`);
    });

    it('write-capabilities.ts derives every row in its wider Core Commands table', async () => {
      const generated = await generatedCapabilities();
      // Every row that was hardcoded pre-fix must equal its Command's live length.
      expect(generated).toContain(`\`hooks\` | ${hooksSubcommands.length}`);
      expect(generated).not.toMatch(/\| `init` \| 5 \|/); // real is 6 — proves it isn't just re-hardcoded at a different number
      expect(generated).not.toMatch(/\| `agent` \| 7 \|/); // real is 10
      expect(generated).not.toMatch(/\| `monoswarm` \| 6 \|/); // real is 5
      expect(generated).not.toMatch(/\| `mcp` \| 9 \|/); // real is 11
    });

    // dev-lead follow-up round: reviewer found the SAME defect one section
    // down — the "Advanced Commands" table (security/performance/providers/
    // guidance/doctor/completions) was still hardcoded. Four of five
    // happened to be right (6/4/4/1) and `doctor` had drifted (table said 1,
    // real is 0 — doctor is a flat, flags-only command with no
    // `subcommands` array at all). Imports each Command object directly as
    // ground truth, same discipline as the worker-names test above.
    it('the Advanced Commands table is derived too, including the zero-subcommand doctor row', async () => {
      const { securityCommand } = await import('../commands/security.js');
      const { performanceCommand } = await import('../commands/performance.js');
      const { providersCommand } = await import('../commands/providers.js');
      const { guidanceCommand } = await import('../commands/guidance.js');
      const { doctorCommand } = await import('../commands/doctor.js');
      const { completionsCommand } = await import('../commands/completions.js');

      const generated = await generatedCapabilities();
      const advanced = [
        ['security', securityCommand],
        ['performance', performanceCommand],
        ['providers', providersCommand],
        ['guidance', guidanceCommand],
        ['doctor', doctorCommand],
        ['completions', completionsCommand],
      ] as const;

      for (const [name, command] of advanced) {
        const count = command.subcommands?.length ?? 0;
        expect(generated, `${name} should render its live subcommand count`).toContain(
          `\`${name}\` | ${count}`,
        );
      }
      // The specific drift the reviewer found: doctor is a real 0, not the
      // hardcoded 1 — and rendering a bare "0" without context reads as an
      // oddity, so the row must still say WHY it's zero.
      expect(doctorCommand.subcommands).toBeUndefined();
      expect(generated).toContain('`doctor` | 0 | Health diagnostics — flat command, flags only');
    });
  });

  describe('§2 — worker count is a derived build-time constant', () => {
    it('the generated doc equals WORKER_COUNT from generated-counts.ts, not a literal', () => {
      const generated = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() });
      expect(generated).toContain(`${WORKER_COUNT} background workers`);
      expect(generated).not.toContain('8 background workers');
    });

    it('generate-doc-counts.mjs --check exits 0 (generated-counts.ts is not stale)', () => {
      expect(() =>
        execFileSync(
          process.execPath,
          [join(REPO_ROOT, 'scripts', 'generate-doc-counts.mjs'), '--check'],
          { cwd: REPO_ROOT, stdio: 'pipe' },
        ),
      ).not.toThrow();
    });

    // i-035 reviewer MAJOR 1: deriving the worker COUNT did not fix the
    // worker TABLE beneath it — the count read the right number (9) while
    // the row list underneath stayed a hand-maintained 14 entries naming 6
    // workers that don't exist and omitting the one real `reflexion`
    // worker. Ground truth is @monoes/hooks's own WORKER_CONFIGS, imported
    // directly — NOT generated-counts.ts's WORKER_ROWS, so this can't pass
    // by only checking the generator agrees with itself.
    it('every worker name rendered in the generated docs is a real WORKER_CONFIGS key, and every key is rendered', async () => {
      const { WORKER_CONFIGS } = await import('@monoes/hooks');
      const groundTruthNames = new Set(Object.keys(WORKER_CONFIGS));
      expect(groundTruthNames.size).toBeGreaterThan(0); // sanity: import actually resolved

      const generated = generateClaudeMd(
        { ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() },
        'full', // the Background Workers table only renders in 'full'
      );
      const sectionStart = generated.indexOf('### Background Workers');
      const sectionEnd = generated.indexOf('\n\n```bash', sectionStart);
      const workerSection = generated.slice(
        sectionStart,
        sectionEnd === -1 ? undefined : sectionEnd,
      );
      const renderedNames = [...workerSection.matchAll(/^\| `([a-z]+)` \|/gm)].map((m) => m[1]);
      expect(renderedNames.length).toBeGreaterThan(0);

      for (const name of renderedNames) {
        expect(groundTruthNames.has(name), `"${name}" is not a real WORKER_CONFIGS key`).toBe(true);
      }
      for (const name of groundTruthNames) {
        expect(renderedNames, `WORKER_CONFIGS key "${name}" is missing from the table`).toContain(
          name,
        );
      }
    });

    it('CAPABILITIES.md: same names-match check as the CLAUDE.md table', async () => {
      const { WORKER_CONFIGS } = await import('@monoes/hooks');
      const groundTruthNames = new Set(Object.keys(WORKER_CONFIGS));

      const generated = await generatedCapabilities();
      // Anchor on the actual heading, not the ToC entry a few lines above it
      // (which also contains the substring "Background Workers"), and stop
      // at the next `---` section break so a later, unrelated table (Vote
      // Strategies' `majority`/`supermajority`/...) isn't swept in too.
      const sectionStart = generated.indexOf('Background Workers (@monoes/hooks');
      const sectionEnd = generated.indexOf('\n---', sectionStart);
      const workerSection = generated.slice(
        sectionStart,
        sectionEnd === -1 ? undefined : sectionEnd,
      );
      const renderedNames = [...workerSection.matchAll(/^\| `([a-z]+)` \|/gm)].map((m) => m[1]);
      expect(renderedNames.length).toBeGreaterThan(0);

      for (const name of renderedNames) {
        expect(groundTruthNames.has(name), `"${name}" is not a real WORKER_CONFIGS key`).toBe(true);
      }
      for (const name of groundTruthNames) {
        expect(renderedNames, `WORKER_CONFIGS key "${name}" is missing from the table`).toContain(
          name,
        );
      }
    });
  });

  describe('§3 — optional-package availability reflects reality, not a require.resolve bug', () => {
    afterEach(() => {
      _resetOptionalPackageCache();
    });

    it('a genuinely installed package (@monoes/hooks) resolves true — the require.resolve bug is fixed', () => {
      // Pre-fix this returned false for @monoes/hooks even when installed,
      // because its package.json exports gate the root entry behind an
      // `import` condition only, which `require.resolve` cannot satisfy.
      expect(_isOptionalPackageResolvable('@monoes/hooks')).toBe(true);
    });

    it('the inverse case still works: an unresolvable name is still reported unresolvable', () => {
      // Proves the fix didn't just delete the unavailable-note mechanism —
      // a package that truly is not installed is still detected as such.
      expect(_isOptionalPackageResolvable('this-package-genuinely-does-not-exist-i041')).toBe(
        false,
      );
    });

    it.each(TEMPLATES)(
      '%s: with @monoes/hooks genuinely installed, no generated doc says "unavailable in this install"',
      (tmpl) => {
        _resetOptionalPackageCache();
        const generated = generateClaudeMd(
          { ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() },
          tmpl,
        );
        expect(generated).not.toMatch(/unavailable in this install/);
      },
    );

    it('CAPABILITIES.md: with @monoes/hooks genuinely installed, no "unavailable in this install"', async () => {
      expect(await generatedCapabilities()).not.toMatch(/unavailable in this install/);
    });
  });

  // i-035 reviewer MAJOR 4: plan §4 scoped the dead-var removal to
  // claudemd-generator.ts and mcp-generator.ts only — opencode-generator.ts,
  // kimi-generator.ts and codex-generator.ts still write the same five dead
  // vars into their own generated configs (tracked as a follow-up; see
  // codex-generator.test.ts:51, which asserts MONOMIND_MAX_AGENTS is present
  // and needs re-pointing when that follow-up lands). This describe's name
  // says exactly that, not a repo-wide claim the suite below doesn't check.
  describe('§4 — no dead MONOMIND_* env var in the generated CLAUDE.md or the generated .mcp.json', () => {
    function readersOf(varName: string): boolean {
      try {
        // i-035 reviewer MAJOR 3: this used to compute the filtered/excluded
        // result and throw it away, `return true`-ing on any grep exit 0 —
        // including a hit that exists ONLY in packages/**/dist/ (stale build
        // output) or ONLY in a test file, exactly the two cases these
        // filters exist to rule out. Use the filtered result.
        const hits = execFileSync(
          'grep',
          [
            '-rl',
            `process\\.env\\.${varName}\\b`,
            '--include=*.ts',
            '--include=*.mjs',
            '--include=*.cjs',
            'packages/',
          ],
          { cwd: REPO_ROOT, stdio: 'pipe' },
        )
          .toString()
          .split('\n')
          .filter(Boolean)
          .filter(
            (f) => !f.includes('/dist/') && !f.includes('__tests__') && !f.includes('.test.'),
          );
        return hits.length > 0;
      } catch {
        return false;
      }
    }

    it('every MONOMIND_* var named in the generated CLAUDE.md has a real process.env reader', () => {
      // envVars() only composes into the 'full' template.
      const generated = generateClaudeMd(
        { ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() },
        'full',
      );
      const names = [...new Set(generated.match(/MONOMIND_[A-Z0-9_]+/g) ?? [])];
      expect(names.length).toBeGreaterThan(0); // sanity: the section still exists
      for (const name of names) {
        expect(readersOf(name), `${name} should have a process.env reader`).toBe(true);
      }
    });

    it('every MONOMIND_* var written into the generated .mcp.json has a real process.env reader', () => {
      const json = generateMCPJson({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() });
      const names = [...new Set(json.match(/MONOMIND_[A-Z0-9_]+/g) ?? [])];
      // Explicit, not accidental: all five MONOMIND_* vars this file used to
      // write were dead (no reader anywhere), so the correct current state
      // is zero survivors — an empty loop below is the desired outcome, not
      // a vacuous-pass risk. The `not.toContain` pins below already name
      // exactly which ones must be gone.
      expect(names).toEqual([]);
      for (const name of names) {
        expect(readersOf(name), `${name} should have a process.env reader`).toBe(true);
      }
      // Pin the specific dead vars this item removed — proves they're gone,
      // not merely renamed.
      expect(json).not.toContain('MONOMIND_MODE');
      expect(json).not.toContain('MONOMIND_TOPOLOGY');
      expect(json).not.toContain('MONOMIND_MAX_AGENTS');
      expect(json).not.toContain('MONOMIND_MEMORY_BACKEND');
    });
  });

  describe('§5 — @latest stripped from prose (registry round-trip on every invocation)', () => {
    it.each(TEMPLATES)('%s: no `npx monomind@latest` in generated CLAUDE.md', (tmpl) => {
      const generated = generateClaudeMd(
        { ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() },
        tmpl,
      );
      expect(generated).not.toMatch(/monomind@latest/);
    });

    it('no `npx monomind@latest` in generated CAPABILITIES.md', async () => {
      expect(await generatedCapabilities()).not.toMatch(/npx monomind@latest/);
    });
  });

  describe('§4 — no recommendation of the deprecated `hooks session-start`', () => {
    it.each(TEMPLATES)('%s: does not recommend `session-start`', (tmpl) => {
      const generated = generateClaudeMd(
        { ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() },
        tmpl,
      );
      expect(generated).not.toMatch(/`session-start`/);
    });
  });

  describe('i-035 regression guard (same worktree, same two generators)', () => {
    it("the honest monoswarm sentence still survives this item's edits", () => {
      // Only swarmOrchestration() ("## Monoswarm Orchestration", full/
      // security/performance) and swarmRules() ("## Monoswarm Rules",
      // standard) carry i-035's honest sentence — antiDriftConfig(),
      // autoStartProtocol() and executionRules() never made the claim it
      // replaces, so a broad "## Monoswarm" substring match would wrongly
      // flag them.
      for (const generated of allTemplateDocs()) {
        if (
          generated.includes('## Monoswarm Orchestration') ||
          generated.includes('## Monoswarm Rules')
        ) {
          expect(generated).toContain(HONEST_MONOSWARM_SENTENCE);
        }
      }
    });
  });
});
