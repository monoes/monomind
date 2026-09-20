/**
 * i-066: gitignore coverage for the monoes.me refresh-token file, and the
 * "never narrow an existing blanket ignore" invariant for
 * `write-runtime-config.ts`'s project-.gitignore rewrite.
 *
 * Uses the real `git check-ignore`/`git status` matcher, not a string
 * compare against the generated file's contents — a pattern can be present
 * in the file and still not match the target path (e.g. `*.token` does not
 * match a file literally named `monoes-connection.json`).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import {
  MONOMIND_GITIGNORE_SPECIFIC_EXCLUDES,
  MONOMIND_NEVER_COMMIT,
  writeRuntimeConfig,
} from '../init/write-runtime-config.js';

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
  targetDir = mkdtempSync(join(tmpdir(), 'monomind-gitignore-test-'));
  execFileSync('git', ['init', '--quiet'], { cwd: targetDir });
  mkdirSync(join(targetDir, '.monomind'), { recursive: true });
});

afterEach(() => {
  rmSync(targetDir, { recursive: true, force: true });
});

function run(result: InitResult = freshResult(), force = true) {
  const options = {
    ...DEFAULT_INIT_OPTIONS,
    targetDir,
    force,
    interactive: false,
  };
  return writeRuntimeConfig(targetDir, options, result);
}

// Deliberately NOT `-v`: `git check-ignore -v` prints the last matching
// pattern (including a negation) but its documented exit status ("0 = the
// path is ignored") does not actually hold once that last match is a
// negation — empirically, `-v` exits 0 whenever ANY pattern matched, ignore
// or un-ignore. Plain `check-ignore` (no `-v`) exits 0 only when the path is
// genuinely ignored, which is what every caller here relies on (i-052
// commit 2's AC-11 assertions are exactly the "un-ignored by a negation"
// case that `-v` gets wrong). The `-v` output is captured separately, only
// as a diagnostic — never as the source of `exitCode`.
function gitCheckIgnore(relPath: string): { exitCode: number; stdout: string } {
  let stdout = '';
  try {
    stdout = execFileSync('git', ['check-ignore', '-v', relPath], {
      cwd: targetDir,
      encoding: 'utf8',
    });
  } catch (err) {
    stdout = String((err as { stdout?: Buffer | string }).stdout ?? '');
  }
  try {
    execFileSync('git', ['check-ignore', relPath], { cwd: targetDir, stdio: 'pipe' });
    return { exitCode: 0, stdout };
  } catch (err) {
    const e = err as { status?: number };
    return { exitCode: e.status ?? 1, stdout };
  }
}

function gitStatusPorcelain(): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: targetDir, encoding: 'utf8' });
}

describe('generated .monomind/.gitignore covers monoes-connection.json (real matcher)', () => {
  it('git check-ignore -v exits 0 for .monomind/monoes-connection.json', async () => {
    await run();
    const { exitCode } = gitCheckIgnore('.monomind/monoes-connection.json');
    expect(exitCode).toBe(0);
  });
});

// i-052 — the live incident this item fixes: `.monomind/dashboard-token`
// (a live monomind dashboard credential) was not gitignored anywhere,
// because none of the three curated lists named it and `*.token` requires
// a dot, which the extensionless filename doesn't have. Real matcher, not
// a string search against the generated file — `*.token` is present in the
// file already and still doesn't match this specific name, which is
// exactly how the gap shipped undetected.
describe('generated .monomind/.gitignore covers every MONOMIND_NEVER_COMMIT entry (i-052)', () => {
  it.each(MONOMIND_NEVER_COMMIT.map(({ file }) => file))(
    'git check-ignore -v exits 0 for .monomind/%s',
    async (file) => {
      await run();
      const { exitCode } = gitCheckIgnore(`.monomind/${file}`);
      expect(exitCode).toBe(0);
    },
  );

  // AC-0's positive controls: proves the harness (git, the test repo, the
  // matcher call) actually works, so a passing dashboard-token assertion
  // can't be explained by a broken check that would pass anything.
  it('positive controls: .monomind/foo.token and .monomind/daemon.pid are still ignored', async () => {
    await run();
    expect(gitCheckIgnore('.monomind/foo.token').exitCode).toBe(0);
    expect(gitCheckIgnore('.monomind/daemon.pid').exitCode).toBe(0);
  });

  // Negative control matching the ORIGINAL bug report exactly: `*.token`
  // alone (without this fix) does not match an extensionless filename.
  // This assertion is about the underlying glob semantics, not this
  // module — it documents WHY the bug was invisible to a reader who only
  // checked "is *.token in the file".
  it('control: a bare *.token pattern alone would not have matched dashboard-token', () => {
    expect('dashboard-token').not.toMatch(/\.token$/);
  });
});

describe('init never narrows an existing blanket .monomind/ ignore', () => {
  it('a bare `.monomind/` line in the root .gitignore survives init untouched', async () => {
    writeFileSync(join(targetDir, '.gitignore'), 'node_modules/\n.monomind/\n');

    await run();

    const rootGitignore = readFileSync(join(targetDir, '.gitignore'), 'utf-8');
    expect(rootGitignore).toMatch(/^\.monomind\/\s*$/m);
  });

  it('leaves no .monomind/** path untracked-but-visible in git status after init', async () => {
    writeFileSync(join(targetDir, '.gitignore'), '.monomind/\n');

    await run();

    const status = gitStatusPorcelain();
    const monomindPaths = status
      .split('\n')
      .filter((line) => line.trim())
      .filter((line) => line.includes('.monomind/'));
    expect(monomindPaths).toEqual([]);
  });

  it('does not report a .gitignore update when the blanket line is left alone', async () => {
    writeFileSync(join(targetDir, '.gitignore'), '.monomind/\n');

    const result = freshResult();
    await run(result);

    expect(result.updated).toEqual([]);
  });
});

// i-066 reviewer finding 3 (MAJOR, priority), generalised for i-052: a
// project inited BEFORE a MONOMIND_NEVER_COMMIT entry existed — which, for
// `dashboard-token`, is every project on the machine, since the dashboard
// writes it on every restart regardless of when `init` last ran — must
// still get coverage on a later, non-forced init. AC-2: this is the
// criterion that reaches the installed base, which commit 2's deny-by-
// default inversion (new projects only) explicitly does not.
describe('an existing pre-fix .monomind/.gitignore gets every MONOMIND_NEVER_COMMIT entry appended, even without --force', () => {
  const PRE_FIX_GITIGNORE = `# Monomind — exclude files that may contain secrets or sensitive prompt data
sessions/
security/
*.tmp
*.log
daemon.pid
*.key
*.token
*.secret
.env
`;

  it('appends coverage for every entry on a force:false re-init', async () => {
    const gitignorePath = join(targetDir, '.monomind', '.gitignore');
    writeFileSync(gitignorePath, PRE_FIX_GITIGNORE);

    await run(freshResult(), false);

    for (const { file } of MONOMIND_NEVER_COMMIT) {
      const { exitCode } = gitCheckIgnore(`.monomind/${file}`);
      expect(exitCode, `.monomind/${file} should be ignored after the append`).toBe(0);
    }
    // The user's original lines must survive untouched, not be replaced.
    const after = readFileSync(gitignorePath, 'utf-8');
    expect(after).toContain('sessions/');
    expect(after).toContain('*.token');
  });

  it('reports the update so the run is visible, and is idempotent on a second force:false run', async () => {
    const gitignorePath = join(targetDir, '.monomind', '.gitignore');
    writeFileSync(gitignorePath, PRE_FIX_GITIGNORE);

    const firstResult = freshResult();
    await run(firstResult, false);
    expect(firstResult.updated).toEqual([
      `.monomind/.gitignore (added ${MONOMIND_NEVER_COMMIT.map(({ file }) => file).join(', ')} coverage)`,
    ]);
    const afterFirst = readFileSync(gitignorePath, 'utf-8');

    const secondResult = freshResult();
    await run(secondResult, false);
    expect(secondResult.updated).toEqual([]); // already covered — no duplicate append
    expect(readFileSync(gitignorePath, 'utf-8')).toBe(afterFirst);
  });

  it('does not touch an existing .monomind/.gitignore that already covers every entry', async () => {
    const gitignorePath = join(targetDir, '.monomind', '.gitignore');
    const alreadyCovered = `${PRE_FIX_GITIGNORE}${MONOMIND_NEVER_COMMIT.map(({ file }) => file).join('\n')}\n`;
    writeFileSync(gitignorePath, alreadyCovered);

    const result = freshResult();
    await run(result, false);

    expect(result.updated).toEqual([]);
    expect(readFileSync(gitignorePath, 'utf-8')).toBe(alreadyCovered);
  });

  it('appends only the entries actually missing when some are already covered', async () => {
    const gitignorePath = join(targetDir, '.monomind', '.gitignore');
    // Already covers monoes-connection.json (i-066's original fix), but
    // predates dashboard-token and enable-terminal.json.
    writeFileSync(gitignorePath, `${PRE_FIX_GITIGNORE}monoes-connection.json\n`);

    const result = freshResult();
    await run(result, false);

    expect(result.updated).toEqual([
      '.monomind/.gitignore (added dashboard-token, enable-terminal.json coverage)',
    ]);
    expect(gitCheckIgnore('.monomind/monoes-connection.json').exitCode).toBe(0);
    expect(gitCheckIgnore('.monomind/dashboard-token').exitCode).toBe(0);
    expect(gitCheckIgnore('.monomind/enable-terminal.json').exitCode).toBe(0);
  });
});

// i-066 reviewer, "Plus one addition": the replacementIsBlanketEquivalent
// guard's whole safety argument rests on the specific-excludes list never
// itself being blanket-shaped. Pin that as an executable assertion, not
// just a comment — if a future edit ever adds a `.monomind/*` or
// `.monomind/**` entry to this list, the never-narrow guarantee silently
// stops holding and this test must catch it.
describe('the specific-excludes replacement list is never itself blanket-shaped', () => {
  it('MONOMIND_GITIGNORE_SPECIFIC_EXCLUDES contains no entry that would match everything under .monomind/', () => {
    const blanketShaped = MONOMIND_GITIGNORE_SPECIFIC_EXCLUDES.filter((line) =>
      /^\.monomind\/\*{1,2}\/?$/.test(line.trim()),
    );
    expect(blanketShaped).toEqual([]);
  });
});

// i-052 §2(ii) / commit 2 — deny-by-default. Three independently-maintained
// denylists (§1 of the plan) all separately omitted `dashboard-token`; a
// denylist can always omit its next dangerous file too. Inverting a FRESH
// project's generated .monomind/.gitignore to `*` plus a narrow allow-list
// means a file monomind starts writing tomorrow, that nobody remembers to
// add anywhere, is ignored by construction — the failure mode becomes
// "forgot to un-ignore something harmless" (visible, recoverable) instead
// of "leaked a credential". Existing projects are migrated ONLY by the
// content-guarded append (already covered above) — never rewritten to this
// shape, since a user may have deliberately committed something under
// .monomind/ and silently un-committing it is a different kind of harm.
describe('deny-by-default: a fresh .monomind/.gitignore ignores everything except the allow-list (commit 2)', () => {
  it('ignores a file monomind has never named anywhere, by construction', async () => {
    await run();
    // Deliberately NOT in MONOMIND_NEVER_COMMIT, MONOMIND_GITIGNORE_SPECIFIC_EXCLUDES,
    // or any specific pattern anywhere — the point is that nobody has to add it.
    const { exitCode } = gitCheckIgnore('.monomind/some-future-file-nobody-named.dat');
    expect(exitCode).toBe(0);
  });

  it('still ignores every MONOMIND_NEVER_COMMIT entry (belt-and-braces with the allow-list inversion)', async () => {
    await run();
    for (const { file } of MONOMIND_NEVER_COMMIT) {
      expect(gitCheckIgnore(`.monomind/${file}`).exitCode, `.monomind/${file}`).toBe(0);
    }
  });

  // AC-11: the inversion's own risk is an allow-list that forgets an entry,
  // silently stopping the user committing their org configs. These must
  // stay committable after commit 2, same as before it.
  it('AC-11: config.yaml, CAPABILITIES.md and orgs/*.json remain committable', async () => {
    await run();
    writeFileSync(join(targetDir, '.monomind', 'config.yaml'), 'version: "3.0.0"\n');
    writeFileSync(join(targetDir, '.monomind', 'CAPABILITIES.md'), '# Capabilities\n');
    mkdirSync(join(targetDir, '.monomind', 'orgs'), { recursive: true });
    writeFileSync(join(targetDir, '.monomind', 'orgs', 'sample-team.json'), '{}\n');

    expect(gitCheckIgnore('.monomind/config.yaml').exitCode).toBe(1);
    expect(gitCheckIgnore('.monomind/CAPABILITIES.md').exitCode).toBe(1);
    expect(gitCheckIgnore('.monomind/orgs/sample-team.json').exitCode).toBe(1);
  });

  // AC-11 (anti-over-correction, the other direction): dev-lead ruling —
  // the plan's original allow-list named `knowledge/`, but
  // `.monomind/knowledge/{chunks,doc-metadata}.jsonl` is the actual
  // ingested content of the user's own files, not metadata — exactly what
  // README/privacy.md's "Your notes never leave your computer" claim is
  // about (also independently required ignored by doctor-project-checks.ts's
  // pre-existing REQUIRED_GITIGNORE_PATTERNS). Un-ignoring it by default
  // would be a larger privacy regression than the credential this item
  // fixes. Pinned here so a future "why isn't knowledge/ on the allow-list,
  // that looks like an omission" fix is caught by a red test instead of
  // silently reintroducing the leak.
  it('AC-11 (anti-over-correction): .monomind/knowledge/ stays ignored on a fresh init', async () => {
    await run();
    mkdirSync(join(targetDir, '.monomind', 'knowledge'), { recursive: true });
    writeFileSync(join(targetDir, '.monomind', 'knowledge', 'chunks.jsonl'), '{}\n');
    expect(gitCheckIgnore('.monomind/knowledge/chunks.jsonl').exitCode).toBe(0);
  });

  it('the generated .monomind/.gitignore file itself remains committable', async () => {
    await run();
    expect(gitCheckIgnore('.monomind/.gitignore').exitCode).toBe(1);
  });

  it('does NOT apply to an existing pre-fix project — the append path is untouched by the inversion', async () => {
    const gitignorePath = join(targetDir, '.monomind', '.gitignore');
    const preFix = '*.tmp\ndaemon.pid\n';
    writeFileSync(gitignorePath, preFix);

    await run(freshResult(), false);

    const after = readFileSync(gitignorePath, 'utf-8');
    // Still additive: the user's original content survives, and no bare
    // `*` deny-by-default line was introduced by the append path.
    expect(after).toContain('*.tmp');
    expect(after.split('\n').map((l) => l.trim())).not.toContain('*');
  });
});
