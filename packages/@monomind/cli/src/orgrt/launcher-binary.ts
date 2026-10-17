// packages/@monomind/cli/src/orgrt/launcher-binary.ts
/**
 * `codex` and `agy` on a mise machine are launcher scripts:
 *
 *   mise use -g --quiet "<tool>" || exit 1
 *   exec mise x "<tool>" -- "<exe>" "$@"
 *
 * `mise use -g` writes ~/.config/mise/config.toml on every start, so a role run
 * with a read-only HOME dies before the model starts ("mise ERROR Read-only file
 * system"); `agent test` runs outside the role sandbox and does not see it. The
 * runners run the real binary `mise which <exe>` names instead, which only reads.
 * Anything that is not such a launcher, or whose real binary cannot be found, is
 * returned as it came.
 */
import { execFileSync } from 'node:child_process';
import { accessSync, closeSync, constants, openSync, readSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const LAUNCHER = /\bmise use -g\b[\s\S]*\bexec mise x "[^"]+" -- "([^"]+)"/;
const answers = new Map<string, string>();

const executable = (p: string): boolean => {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

function find(bin: string, env: NodeJS.ProcessEnv): string | null {
  if (bin.includes('/')) return executable(bin) ? bin : null;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir && executable(join(dir, bin))) return join(dir, bin);
  }
  return null;
}

/** The first 2 KB of a file: enough to recognise a script, never a whole binary. */
function head(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(2048);
    return buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** `bin`, or the real binary behind it when `bin` is a mise launcher. */
export function realBinary(bin: string, env: NodeJS.ProcessEnv = process.env): string {
  const path = find(bin, env);
  if (!path) return bin;
  const key = `${path}\0${env.PATH ?? ''}`;
  const known = answers.get(key);
  if (known !== undefined) return known;
  let answer = bin;
  try {
    const launcher = LAUNCHER.exec(head(path));
    const mise = launcher ? find('mise', env) : null;
    if (launcher && mise) {
      const real = execFileSync(mise, ['which', launcher[1]], {
        env,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (real && executable(real)) answer = real;
    }
  } catch {
    /* keep the launcher: the runner will report what it does */
  }
  answers.set(key, answer);
  return answer;
}
