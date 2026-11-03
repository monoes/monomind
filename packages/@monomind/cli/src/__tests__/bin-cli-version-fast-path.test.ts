import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

// bin/cli.js answers a bare --version / -V itself, without loading the CLI.
describe('bin/cli.js --version fast path', () => {
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [join(root, 'bin', 'cli.js'), ...args], {
      encoding: 'utf-8',
      env: { ...process.env, MONOMIND_AUTO_UPDATE: 'false', CI: '1' },
    });

  it.each(['--version', '-V'])('%s prints name and package.json version', (flag) => {
    expect(run(flag)).toMatch(
      new RegExp(`^monomind v${version.replaceAll('.', '\\.')}(  .*)?\\n$`),
    );
  });

  it('still serves --version --json from the full CLI', () => {
    expect(JSON.parse(run('--version', '--json')).version).toBe(version);
  });
});
