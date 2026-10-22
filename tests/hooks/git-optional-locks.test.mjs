/**
 * #681: read-only git calls made by hooks/helpers/tools in a shared checkout
 * must not take .git/index.lock (`git status`/`git diff` refresh the index);
 * a call killed by its timeout mid-refresh leaves a stale empty lock behind.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

describe('statusline git calls (#681)', () => {
  it('runs git with GIT_OPTIONAL_LOCKS=0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gol-'));
    try {
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      const log = path.join(dir, 'env.log');
      fs.writeFileSync(
        path.join(bin, 'git'),
        `#!/bin/sh\necho "$GIT_OPTIONAL_LOCKS $*" >> "${log}"\n`,
        { mode: 0o755 },
      );
      fs.mkdirSync(path.join(dir, '.monomind'));
      execFileSync(
        process.execPath,
        [path.join(ROOT, '.claude/helpers/statusline.cjs'), '--json'],
        {
          cwd: dir,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: dir },
          stdio: 'ignore',
        },
      );
      const lines = fs.readFileSync(log, 'utf-8').trim().split('\n');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((l) => l.startsWith('0 '))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('other index-refreshing git calls (#681)', () => {
  const sites = [
    ['packages/@monomind/monograph/src/staleness/git-staleness.ts', 'git status --porcelain'],
    ['.claude/helpers/handlers/session-handler.cjs', 'git diff --name-only'],
    ['packages/@monomind/cli/scripts/understand-analyze-git.mjs', "runGit(['status'"],
    ['packages/@monomind/cli/src/commands/doctor-catalog-checks.ts', "'diff', '--quiet'"],
  ];
  it.each(sites)('%s opts out of optional locks', (file) => {
    expect(read(file)).toMatch(/GIT_OPTIONAL_LOCKS|--no-optional-locks/);
  });
});
