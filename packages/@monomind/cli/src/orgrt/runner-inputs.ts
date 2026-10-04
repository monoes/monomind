/** #599: trusted CLI input must not live in another turn's writable TMPDIR.
 * The authority mask keeps non-allowlisted ~/.monomind entries read-only,
 * while the unsandboxed parent can create and clean up each run's inputs. */
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AgentRunArgs } from './agent-runner.js';
import { monomindHome } from './operator-protected-paths.js';
import { isWithin, realPath } from './policy-paths.js';

export function createRunnerInputDir(
  runner: 'hermes' | 'cline' | 'kimi',
  args: Pick<AgentRunArgs, 'cwd' | 'env'>,
): string {
  const base = monomindHome(homedir(), process.env);
  const root = join(base, 'runner-inputs');
  const canonical = realPath(root);
  const tempRoots = [
    tmpdir(),
    ...(process.platform === 'win32' ? [] : ['/tmp', '/var/tmp', '/private/tmp']),
  ];
  for (const env of [process.env, args.env])
    for (const key of ['TMPDIR', 'TMP', 'TEMP']) if (env[key]) tempRoots.push(env[key]!);
  if ([args.cwd, ...tempRoots].some((p) => isWithin(realPath(resolve(p)), canonical))) {
    throw new Error(
      'Runner inputs require a monomind home outside the workspace and writable temporary roots. Move HOME or MONOMIND_HOME to a protected location.',
    );
  }
  // Refuse redirection even when a symlink currently targets a safe location.
  // Walk existing ancestors before creating anything or writing trusted input.
  for (let p = root; ; p = dirname(p)) {
    try {
      if (lstatSync(p).isSymbolicLink())
        throw new Error(`Runner input directory must not use a symlink: ${p}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(p) === p) break;
  }
  for (const dir of [base, root]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.getuid && stat.uid !== process.getuid()) ||
      (process.platform !== 'win32' && stat.mode & 0o022)
    ) {
      throw new Error(
        `Runner input directory must be owned by the current user and not writable by others: ${dir}`,
      );
    }
  }
  return mkdtempSync(join(root, `${runner}-`));
}

/** Preserve private permissions and refuse a substituted symlink on rewrites. */
export function writeRunnerInput(file: string, text: string): void {
  const fd = openSync(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(fd, text);
  } finally {
    closeSync(fd);
  }
}
