/** #599: trusted CLI input must not live in another turn's writable TMPDIR.
 * The authority mask keeps non-allowlisted ~/.monomind entries read-only,
 * while the unsandboxed parent can create and clean up each run's inputs. */
import { createHash } from 'node:crypto';
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

/** The directory under the shared root that holds one org role's inputs. Every role runs as the same
 *  user, so a shared directory would show one role the prompt (mail digests, section documents) of
 *  another: the authority mask hides every other role's holder (documents/role-protection.ts). */
export function runnerInputHolder(monomindDir: string, orgDir: string, role: string): string {
  const key = createHash('sha256').update(`${orgDir}\0${role}`).digest('hex').slice(0, 16);
  return join(monomindDir, 'runner-inputs', `role-${key}`);
}

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
  const orgDir = args.env.MONOMIND_ORG_DIR;
  const role = args.env.MONOMIND_ORG_ROLE;
  const holder = orgDir && role ? runnerInputHolder(base, orgDir, role) : undefined;
  for (const dir of holder ? [base, root, holder] : [base, root]) {
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
  return mkdtempSync(join(holder ?? root, `${runner}-`));
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
