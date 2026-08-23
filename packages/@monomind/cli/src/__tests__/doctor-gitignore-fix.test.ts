import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkGitignoreCoverage, fixGitignoreCoverage } from '../commands/doctor-project-checks.js';

let dir: string;
let cwd: string;

beforeEach(() => {
  cwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'mm-gitignore-'));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

const gitignore = () => join(dir, '.gitignore');

describe('doctor --fix creates a .gitignore when none exists', () => {
  it('writes a file that then passes the check', async () => {
    expect((await checkGitignoreCoverage()).status).toBe('warn');
    expect(await fixGitignoreCoverage()).toBe(true);
    expect(existsSync(gitignore())).toBe(true);

    // The whole point: the file --fix writes must satisfy the checker that
    // demanded it. A blanket `.monomind/` has to count as covering the
    // specific `.monomind/sessions/` etc. entries.
    expect((await checkGitignoreCoverage()).status).toBe('pass');
  });

  it('covers secrets, not just monomind runtime state', async () => {
    await fixGitignoreCoverage();
    const body = readFileSync(gitignore(), 'utf-8');
    for (const pattern of ['.monomind/', '.env', '*.pem', '*.key', 'node_modules/']) {
      expect(body).toContain(pattern);
    }
  });
});

describe('doctor --fix appends to an existing .gitignore', () => {
  it('adds only the missing entries and reaches pass', async () => {
    writeFileSync(gitignore(), 'node_modules/\n.monomind/sessions/\n');
    expect((await checkGitignoreCoverage()).status).toBe('warn');

    expect(await fixGitignoreCoverage()).toBe(true);
    expect((await checkGitignoreCoverage()).status).toBe('pass');
  });

  it('preserves what the user already wrote', async () => {
    writeFileSync(gitignore(), '# my rules\nbuild/\n*.log\n');
    await fixGitignoreCoverage();
    const body = readFileSync(gitignore(), 'utf-8');
    expect(body).toContain('# my rules');
    expect(body).toContain('build/');
    expect(body).toContain('*.log');
  });

  it('is idempotent — a second run changes nothing and reports no write', async () => {
    writeFileSync(gitignore(), 'node_modules/\n');
    await fixGitignoreCoverage();
    const first = readFileSync(gitignore(), 'utf-8');

    expect(await fixGitignoreCoverage()).toBe(false);
    expect(readFileSync(gitignore(), 'utf-8')).toBe(first);
  });

  it('does not concatenate onto a file with no trailing newline', async () => {
    writeFileSync(gitignore(), 'build/');
    await fixGitignoreCoverage();
    expect(readFileSync(gitignore(), 'utf-8')).not.toContain('build/#');
    expect(readFileSync(gitignore(), 'utf-8').split('\n')).toContain('build/');
  });
});

describe('directory ignores count as covering their contents', () => {
  it('a blanket .monomind/ satisfies every .monomind/* requirement', async () => {
    writeFileSync(
      gitignore(),
      '.monomind/\n.hive-mind/\n.swarm/\n**/.claude-flow/\ndata/sessions/\ndata/mastermind-*.json\ndata/mastermind-*.jsonl\n',
    );
    const result = await checkGitignoreCoverage();
    expect(result.status).toBe('pass');
  });

  it('does not treat a glob entry as an ancestor directory', async () => {
    // `.monomind/*.json` must NOT be read as covering `.monomind/sessions/`.
    writeFileSync(gitignore(), '.monomind/*.json\n');
    const result = await checkGitignoreCoverage();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('.monomind/sessions/');
  });

  it('an unrelated prefix does not count', async () => {
    writeFileSync(gitignore(), '.mono/\n');
    const result = await checkGitignoreCoverage();
    expect(result.status).toBe('warn');
  });
});

describe('the fix hint is a runnable instruction, not a broken echo', () => {
  it('never emits a literal backslash-n', async () => {
    const noFile = await checkGitignoreCoverage();
    expect(noFile.fix).toBeDefined();
    expect(noFile.fix).not.toContain('\\n');

    writeFileSync(gitignore(), 'node_modules/\n');
    const partial = await checkGitignoreCoverage();
    expect(partial.fix).toBeDefined();
    expect(partial.fix).not.toContain('\\n');
  });
});
