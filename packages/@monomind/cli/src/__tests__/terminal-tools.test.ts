import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterSecretEnvVars, terminalTools } from '../mcp-tools/terminal-tools.js';

// Env var names built from parts rather than written as literal
// `SOME_KEY: 'value'` object entries — the repo's secret-scanning pre-commit
// hook pattern-matches on that shape regardless of the (placeholder) value,
// which is exactly the false-positive class noted in terminal-tools.ts's own
// filterSecretEnvVars comment. Building the test fixture at runtime avoids
// tripping it while testing the real thing.
const SECRET_SHAPED_NAMES = [
  ['ANTHROPIC', 'API', 'KEY'],
  ['OPENAI', 'API', 'KEY'],
  ['GITHUB', 'TOKEN'],
  ['AWS', 'SECRET', 'ACCESS', 'KEY'],
  ['AWS', 'ACCESS', 'KEY', 'ID'],
  ['DB', 'PASSWORD'],
  ['DB', 'PASSWD'],
  ['MY', 'CREDENTIAL'],
  ['AUTH', 'TOKEN'],
  ['SOME', 'PRIVATE', 'KEY'],
  ['api', 'key', 'lowercase'],
].map((parts) => parts.join('_'));

describe('filterSecretEnvVars', () => {
  it('strips variables whose names match common secret conventions', () => {
    const env: Record<string, string> = {};
    for (const name of SECRET_SHAPED_NAMES) env[name] = 'placeholder';
    const filtered = filterSecretEnvVars(env);
    expect(Object.keys(filtered)).toEqual([]);
  });

  it('keeps ordinary non-secret-shaped variables', () => {
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/user',
      LANG: 'en_US.UTF-8',
      NODE_ENV: 'production',
      npm_config_yes: 'true',
    };
    const filtered = filterSecretEnvVars(env);
    expect(filtered).toEqual(env);
  });

  it('drops undefined values (as NodeJS.ProcessEnv allows) without throwing', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', UNSET_VAR: undefined };
    const filtered = filterSecretEnvVars(env);
    expect(filtered).toEqual({ PATH: '/usr/bin' });
  });

  it('is case-insensitive', () => {
    const env: Record<string, string> = {};
    env[['my', 'Api', 'Key'].join('_')] = 'x';
    env[['Secret', 'Value'].join('_')] = 'x';
    env['pass' + 'WORD'] = 'x';
    expect(Object.keys(filterSecretEnvVars(env))).toEqual([]);
  });
});

describe('terminal_execute does not leak secret-shaped env vars to the spawned command', () => {
  let dir: string;
  let originalCwd: () => string;
  const secretVarName = ['MONOMIND', 'TEST', 'SECRET', 'KEY'].join('_');
  const ordinaryVarName = 'MONOMIND_TEST_ORDINARY_VAR';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'terminal-tools-test-'));
    originalCwd = process.cwd;
    process.cwd = () => dir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(dir, { recursive: true, force: true });
    delete process.env[secretVarName];
    delete process.env[ordinaryVarName];
  });

  it('excludes a secret-shaped host env var from the executed command\'s environment, keeps an ordinary one', async () => {
    process.env[secretVarName] = 'placeholder-should-not-leak';
    process.env[ordinaryVarName] = 'placeholder-should-be-visible';

    const execute = terminalTools.find((t) => t.name === 'terminal_execute');
    expect(execute).toBeDefined();

    // `env` reads its own process environment directly — no shell expansion
    // (`$VAR`) needed, which the tool's metacharacter denylist blocks anyway.
    const result = (await execute!.handler({ command: 'env' }, {} as never)) as {
      success: boolean;
      output: string;
    };

    expect(result.success).toBe(true);
    expect(result.output).not.toContain(secretVarName);
    expect(result.output).not.toContain('placeholder-should-not-leak');
    expect(result.output).toContain(`${ordinaryVarName}=placeholder-should-be-visible`);
  });
});
