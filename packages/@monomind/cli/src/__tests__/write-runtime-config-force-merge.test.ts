/**
 * `init --force` must not destroy what users add to `.monomind/`:
 *  - `.monomind/.gitignore`: the generated template itself tells users to add
 *    `!orgs/<org>.json` lines, and --force used to regenerate the whole file;
 *  - `.monomind/config.yaml`: --force used to overwrite it wholesale.
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
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

let targetDir: string;
beforeEach(() => {
  targetDir = mkdtempSync(join(tmpdir(), 'monomind-runtime-merge-'));
  execFileSync('git', ['init', '--quiet'], { cwd: targetDir });
  mkdirSync(join(targetDir, '.monomind'), { recursive: true });
});
afterEach(() => rmSync(targetDir, { recursive: true, force: true }));

const run = (force = true) =>
  writeRuntimeConfig(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir, force }, freshResult());

const ignored = (rel: string): boolean => {
  try {
    execFileSync('git', ['check-ignore', rel], { cwd: targetDir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

describe('.monomind/.gitignore under --force', () => {
  const gitignorePath = () => join(targetDir, '.monomind', '.gitignore');

  it('rewrites only the managed block and keeps the lines a user added', async () => {
    await run();
    const first = readFileSync(gitignorePath(), 'utf-8');
    expect(first).toMatch(/^# monomind:start gitignore$/m);
    expect(first).toMatch(/^# monomind:end gitignore$/m);

    writeFileSync(gitignorePath(), `${first}!orgs/my-org.json\n# my note\n`);
    await run();

    const after = readFileSync(gitignorePath(), 'utf-8');
    expect(after).toContain('!orgs/my-org.json\n# my note\n');
    expect(after.match(/# monomind:start gitignore/g)).toHaveLength(1);
    mkdirSync(join(targetDir, '.monomind', 'orgs'), { recursive: true });
    writeFileSync(join(targetDir, '.monomind', 'orgs', 'my-org.json'), '{}\n');
    expect(ignored('.monomind/orgs/my-org.json')).toBe(false);
    expect(ignored('.monomind/orgs/my-org-secrets.json')).toBe(true);
  });

  it('migrates an unmarked generated file without losing the user lines appended to it', async () => {
    await run();
    const unmarked = readFileSync(gitignorePath(), 'utf-8')
      .split('\n')
      .filter((line) => !/monomind:(start|end) gitignore/.test(line))
      .join('\n');
    writeFileSync(gitignorePath(), `${unmarked}!orgs/my-org.json\n`);

    await run();

    const after = readFileSync(gitignorePath(), 'utf-8');
    expect(after).toContain('!orgs/my-org.json');
    // The template's lines appear once, inside the block, not twice.
    expect(after.split('\n').filter((line) => line === '!orgs/sample-team.json')).toHaveLength(1);
    expect(after.indexOf('# monomind:end gitignore')).toBeLessThan(
      after.indexOf('!orgs/my-org.json'),
    );
  });
});

describe('.monomind/.gitignore on a plain re-init', () => {
  it('leaves a deny-by-default file alone: its `*` already covers every never-commit file', async () => {
    await run(false);
    writeFileSync(join(targetDir, '.monomind', 'config.yaml'), 'version: "3.0.0"\n');
    const before = readFileSync(join(targetDir, '.monomind', '.gitignore'), 'utf-8');
    await run(false);
    expect(readFileSync(join(targetDir, '.monomind', '.gitignore'), 'utf-8')).toBe(before);
  });
});

describe('.monomind/config.yaml under --force', () => {
  it('keeps user keys and values and adds only missing defaults', async () => {
    const configPath = join(targetDir, '.monomind', 'config.yaml');
    writeFileSync(
      configPath,
      [
        '# my header',
        'version: "3.0.0"',
        'swarm:',
        '  topology: mesh',
        '  myTuning: 7',
        'custom:',
        '  answer: 42',
        '',
      ].join('\n'),
    );

    await run();

    const after = readFileSync(configPath, 'utf-8');
    expect(after).toContain('# my header');
    expect(after).toContain('  topology: mesh');
    expect(after).not.toContain('topology: hierarchical-mesh');
    expect(after).toContain('  myTuning: 7');
    expect(after).toContain('custom:\n  answer: 42');
    // Defaults the user's file lacked are filled in, under the right parent.
    expect(after).toMatch(/swarm:\n(?: {2}.*\n)*? {2}maxAgents: \d+/);
    expect(after).toMatch(/^memory:$/m);
    expect(after).toMatch(/^ {4}enabled: /m); // memory.learningBridge.enabled
  });

  it('is idempotent: a second --force run changes nothing', async () => {
    const configPath = join(targetDir, '.monomind', 'config.yaml');
    writeFileSync(configPath, 'swarm:\n  topology: mesh\n');
    await run();
    const once = readFileSync(configPath, 'utf-8');
    await run();
    expect(readFileSync(configPath, 'utf-8')).toBe(once);
  });
});
