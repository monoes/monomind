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
import { writeRuntimeConfig } from '../init/write-runtime-config.js';

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
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

function run(result: InitResult = freshResult()) {
  const options = {
    ...DEFAULT_INIT_OPTIONS,
    targetDir,
    force: true,
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
