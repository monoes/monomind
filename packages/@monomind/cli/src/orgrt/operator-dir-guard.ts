// packages/@monomind/cli/src/orgrt/operator-dir-guard.ts
/**
 * #643: the operator-credential directory (`~/.monomind/orgrt-operator`, or
 * MONOMIND_ORGRT_OPERATOR_DIR) holds the signing key, the org signatures and
 * the operator credentials. Every role sandbox hides it on purpose, so an org
 * role can never sign or read the key (file-roots.ts HOME_DENY_READ, the SDK
 * sandbox's denyRead/denyWrite, authority-mask.ts).
 *
 * The bubblewrap mask hides it by mounting an empty tmpfs over it. Inside that
 * mount a write "succeeds" and is thrown away with the role's command, which
 * made `org sign` from a role look like it worked while `org run` then found
 * nothing. `org sign` asks this guard first and refuses before writing; `org
 * run` uses the same message to explain a missing signature.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';

const unescapeMount = (s: string): string =>
  s.replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(Number.parseInt(o, 8)));

const realOrSelf = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** Is `dir` itself the mount point of a tmpfs, per /proc/self/mountinfo text? */
function isTmpfsMountPoint(mountinfo: string, dirs: string[]): boolean {
  for (const line of mountinfo.split('\n')) {
    const sep = line.indexOf(' - ');
    if (sep < 0) continue;
    const mount = line.slice(0, sep).split(' ')[4];
    const type = line.slice(sep + 3).split(' ')[0];
    if (mount && type === 'tmpfs' && dirs.includes(unescapeMount(mount))) return true;
  }
  return false;
}

/** Why this process cannot use the operator directory, or undefined when it
 *  can (or the operator has not created it yet). */
export function operatorDirBlockedReason(
  dir: string,
  opts: { mountinfo?: string } = {},
): string | undefined {
  let mountinfo = opts.mountinfo;
  if (mountinfo === undefined) {
    try {
      mountinfo = readFileSync('/proc/self/mountinfo', 'utf8');
    } catch {
      mountinfo = '';
    }
  }
  if (isTmpfsMountPoint(mountinfo, [dir, realOrSelf(dir)]))
    return 'an empty tmpfs is mounted over it in this sandbox';
  try {
    readdirSync(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') return 'it is not readable in this sandbox';
  }
  return undefined;
}

/** The plain statement of the rule, for `org sign` and `org run` in a role. */
export function operatorDirProtectedMessage(dir: string, why?: string): string {
  return (
    `the operator-credential directory (${dir}) is protected from org roles` +
    `${why ? ` (${why})` : ''}: only the operator signs org definitions and holds the signing key. ` +
    'Nothing was written. Ask the operator to run `monomind org sign <org>` in their own terminal, ' +
    'or use a pre-signed org (`monomind org sign <org> --check` reports the state).'
  );
}
