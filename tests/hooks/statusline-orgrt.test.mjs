import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('statusline getActiveOrgs Org Runtime v2 support', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-orgrt-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects running org from runtime.json', () => {
    const orgsDir = path.join(tmpDir, '.monomind', 'orgs', 'alpha-team');
    fs.mkdirSync(orgsDir, { recursive: true });
    const runtimeData = {
      status: 'running',
      run: 'run_test_123',
      pid: process.pid,
      updated: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(orgsDir, 'runtime.json'), JSON.stringify(runtimeData));

    const statuslineScript = path.resolve(__dirname, '../../.claude/helpers/statusline.cjs');
    const out = execFileSync(process.execPath, [statuslineScript, '--json'], {
      cwd: tmpDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
      encoding: 'utf-8',
    });

    const parsed = JSON.parse(out);
    expect(parsed.activeOrgs).toBeDefined();
    expect(parsed.activeOrgs.count).toBe(1);
    expect(parsed.activeOrgs.orgs[0].name).toBe('alpha-team');
    expect(parsed.activeOrgs.orgs[0].running).toBe(true);
  });
});
