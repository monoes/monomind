/**
 * #371: in a repo with no commits yet, `git rev-parse HEAD` fails and its raw
 * "fatal: ambiguous argument 'HEAD'" went straight to the console. The code
 * already treats the failure as "unknown"; git's stderr must stay off-screen.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'mg-unborn-'));
  execFileSync('git', ['init', '-q', repo]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('unborn HEAD (#371)', () => {
  it('checkStaleness and the pipeline commit probe print nothing from git', () => {
    const script = `
      import { openDb, closeDb } from ${JSON.stringify(join(src, 'storage', 'db.ts'))};
      import { checkStaleness } from ${JSON.stringify(join(src, 'staleness', 'git-staleness.ts'))};
      import { resolveGitToplevel } from ${JSON.stringify(join(src, 'analysis', 'git-changed-files.ts'))};
      const db = openDb(${JSON.stringify(join(repo, 'mg.db'))});
      const report = checkStaleness(db, ${JSON.stringify(repo)});
      closeDb(db);
      resolveGitToplevel(${JSON.stringify(join(repo, '..'))});
      process.stdout.write(report.state);
    `;
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: join(src, '..'), // resolves tsx; the code under test gets the repo path
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('unknown');
    expect(r.stderr).not.toMatch(/fatal:/);
  });
});
