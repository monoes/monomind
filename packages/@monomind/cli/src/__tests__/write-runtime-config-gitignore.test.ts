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

function gitCheckIgnore(relPath: string): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync('git', ['check-ignore', '-v', relPath], {
      cwd: targetDir,
      encoding: 'utf8',
    });
    return { exitCode: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string };
    return { exitCode: e.status ?? 1, stdout: String(e.stdout ?? '') };
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

// i-066 reviewer finding 3 (MAJOR, priority): a project inited BEFORE this
// fix — every project that could hold a monoes.me token, since you have to
// have connected to have one — must still get monoes-connection.json
// coverage on a later, non-forced init. The original T3 only proved the
// fresh-install path, since run() hardcoded force:true.
describe('an existing pre-fix .monomind/.gitignore gets monoes-connection.json coverage even without --force', () => {
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

  it('appends coverage on a force:false re-init', async () => {
    const gitignorePath = join(targetDir, '.monomind', '.gitignore');
    writeFileSync(gitignorePath, PRE_FIX_GITIGNORE);

    await run(freshResult(), false);

    const { exitCode } = gitCheckIgnore('.monomind/monoes-connection.json');
    expect(exitCode).toBe(0);
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
      '.monomind/.gitignore (added monoes-connection.json coverage)',
    ]);
    const afterFirst = readFileSync(gitignorePath, 'utf-8');

    const secondResult = freshResult();
    await run(secondResult, false);
    expect(secondResult.updated).toEqual([]); // already covered — no duplicate append
    expect(readFileSync(gitignorePath, 'utf-8')).toBe(afterFirst);
  });

  it('does not touch an existing .monomind/.gitignore that already covers the file', async () => {
    const gitignorePath = join(targetDir, '.monomind', '.gitignore');
    const alreadyCovered = `${PRE_FIX_GITIGNORE}monoes-connection.json\n`;
    writeFileSync(gitignorePath, alreadyCovered);

    const result = freshResult();
    await run(result, false);

    expect(result.updated).toEqual([]);
    expect(readFileSync(gitignorePath, 'utf-8')).toBe(alreadyCovered);
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
