import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateSettingsJson } from '../init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeSettings } from '../init/write-claude.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const ROOT_SETTINGS = join(REPO_ROOT, '.claude', 'settings.json');

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

/** A settings.json that differs from the template in the two ways this suite
 *  needs: existing blocks in the opposite order, and one template block
 *  missing so it has to be appended. */
function seedFromTemplate(projectDir: string): Record<string, unknown> {
  const generated = JSON.parse(
    generateSettingsJson({
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components },
    }),
  );
  for (const event of ['PreToolUse', 'PostToolUse'] as const) {
    const groups = generated.hooks[event] as unknown[];
    if (groups.length < 2) {
      throw new Error(
        `settings template emits ${groups.length} ${event} block(s); this suite needs at least 2`,
      );
    }
    generated.hooks[event] = groups.slice(0, -1).reverse();
  }
  return generated;
}

describe('writeSettings --force preserves original hook block order', () => {
  let tmp: string;
  let projectDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-write-settings-order-'));
    projectDir = join(tmp, 'project');
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    settingsPath = join(projectDir, '.claude', 'settings.json');
    // Seed with a file derived from the template rather than the repo's own
    // .claude/settings.json. Seeding from the committed file made this suite
    // depend on that file DIFFERING from the template: the moment someone
    // synced the two (as "fix(assets): sync the shipped .claude/settings.json"
    // did), the fixture had no block the template lacked, the
    // "appends genuinely new blocks" case stopped being exercised, and the
    // sanity assertion below failed on main for a change that was correct.
    //
    // Derived instead: take what the generator emits, reverse each event's
    // block order and drop the last block. Reversing recreates the regression
    // this suite exists for (the file's order is the opposite of the
    // template's, which mergeHooksPreservingUnknown() used to overwrite), and
    // dropping one guarantees a genuinely new template block to append.
    writeFileSync(settingsPath, JSON.stringify(seedFromTemplate(projectDir), null, 2));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps pre-existing blocks in their original relative order, appends genuinely new template blocks at the end, and ends the file with a trailing newline', async () => {
    const before = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components },
    };
    // What the *current* template emits — derived at runtime rather than
    // hardcoded, so this test checks the invariant (pre-existing order kept,
    // new blocks appended after) instead of pinning today's exact snapshot
    // of the committed root settings.json or settings-generator.ts. Either
    // of those changing for unrelated reasons shouldn't break this test.
    const generated = JSON.parse(generateSettingsJson(options));

    await writeSettings(projectDir, options, freshResult());

    const raw = readFileSync(settingsPath, 'utf-8');
    const after = JSON.parse(raw);

    // PreToolUse and PostToolUse are the two event types whose blocks each
    // have a distinct, meaningful matcher (no shared/empty-matcher
    // ambiguity like SessionStart's no-matcher groups) — the ones the
    // reported bug actually swapped (a Grep|Glob block and a
    // Write|Edit|MultiEdit|NotebookEdit block trading positions).
    let sawMultiBlockFixture = false;
    let sawNewTemplateBlock = false;

    for (const event of ['PreToolUse', 'PostToolUse'] as const) {
      const beforeM: string[] = before.hooks[event].map(
        (g: { matcher?: string }) => g.matcher ?? '',
      );
      const afterM: string[] = after.hooks[event].map((g: { matcher?: string }) => g.matcher ?? '');
      const genM: string[] = generated.hooks[event].map(
        (g: { matcher?: string }) => g.matcher ?? '',
      );

      if (beforeM.length > 1) sawMultiBlockFixture = true;

      // Every block that existed before still appears, in the same
      // relative order — this is what the old mergeHooksPreservingUnknown()
      // broke by rebuilding the array starting from the template's own
      // group order instead of the existing file's.
      expect(afterM.filter((m) => beforeM.includes(m))).toEqual(beforeM);

      // A matcher the template produces but the original file never had is
      // a genuinely new block; it must land after every pre-existing block,
      // not interleaved among them.
      const newMatchers = genM.filter((m) => !beforeM.includes(m));
      if (newMatchers.length > 0) sawNewTemplateBlock = true;
      const lastExistingIndex = afterM.lastIndexOf(beforeM[beforeM.length - 1]);
      for (const m of newMatchers) {
        expect(afterM.indexOf(m)).toBeGreaterThan(lastExistingIndex);
      }
    }

    // Sanity: the fixture and template actually exercise both scenarios
    // this test guards against, so the assertions above aren't vacuous.
    expect(sawMultiBlockFixture).toBe(true);
    expect(sawNewTemplateBlock).toBe(true);

    // Trailing newline: the previously-committed file had one; the
    // regenerated one must too.
    expect(raw.endsWith('\n')).toBe(true);
  });

  it("keeps the repo's own committed settings.json in order through --force", async () => {
    // The real-world case the bug was reported against. It asserts only order
    // preservation, not that the file differs from the template: the two are
    // allowed to be in sync, and this test must keep passing when they are.
    writeFileSync(settingsPath, readFileSync(ROOT_SETTINGS, 'utf-8'));
    const before = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    await writeSettings(
      projectDir,
      {
        ...DEFAULT_INIT_OPTIONS,
        targetDir: projectDir,
        force: true,
        components: { ...DEFAULT_INIT_OPTIONS.components },
      },
      freshResult(),
    );

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    for (const event of Object.keys(before.hooks)) {
      const beforeM: string[] = before.hooks[event].map(
        (g: { matcher?: string }) => g.matcher ?? '',
      );
      const afterM: string[] = after.hooks[event].map((g: { matcher?: string }) => g.matcher ?? '');
      expect(afterM.filter((m) => beforeM.includes(m))).toEqual(beforeM);
    }
  });

  it('produces a byte-identical settings.json on a second `init --force` run (no perpetual reordering)', async () => {
    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components },
    };

    await writeSettings(projectDir, options, freshResult());
    const firstRun = readFileSync(settingsPath, 'utf-8');

    await writeSettings(projectDir, options, freshResult());
    const secondRun = readFileSync(settingsPath, 'utf-8');

    expect(secondRun).toBe(firstRun);
  });

  it('keeps a hand-added hook that shares a matcher with a generator-owned block, without losing it or dropping the original ordering', async () => {
    // Add a custom hook into the existing PreToolUse "Bash" group, alongside
    // the generator-owned pre-bash hook — the trickiest case for a
    // position-preserving merge: the block itself has a template
    // counterpart (so its position is "claimed" by refreshed generated
    // content), but one hook inside it does not.
    const seeded = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const bashGroup = seeded.hooks.PreToolUse.find(
      (g: { matcher?: string }) => g.matcher === 'Bash',
    );
    bashGroup.hooks.push({ type: 'command', command: 'echo custom-bash-guard', timeout: 1000 });
    writeFileSync(settingsPath, JSON.stringify(seeded, null, 2));

    const options = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir: projectDir,
      force: true,
      components: { ...DEFAULT_INIT_OPTIONS.components },
    };
    await writeSettings(projectDir, options, freshResult());

    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const preToolUse = after.hooks.PreToolUse as Array<{
      matcher?: string;
      hooks?: Array<{ command?: string }>;
    }>;

    const allCommands = preToolUse.flatMap((g) => (g.hooks ?? []).map((h) => h.command));
    expect(allCommands).toContain('echo custom-bash-guard');

    // Original relative order is still respected: Bash-related content
    // stays before Grep|Glob, matching the seeded file.
    const matchers = preToolUse.map((g) => g.matcher);
    const firstBashIndex = matchers.indexOf('Bash');
    expect(firstBashIndex).toBeGreaterThanOrEqual(0);
    expect(firstBashIndex).toBeLessThan(matchers.indexOf('Grep|Glob'));
  });
});
