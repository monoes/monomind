// packages/@monomind/cli/src/orgrt/operator-settings.ts
/**
 * #699: operator-only settings that gate what an org role may do. The file
 * is `~/.monomind/operator-settings.json`, shaped like the project config:
 *
 *   { "org": { "allowDrillSigning": false } }
 *
 * Nothing a role can set decides these. The file is located from the
 * passwd-database home directory, never `$HOME` or `$MONOMIND_HOME` (a role
 * can export both), and operator-protected-paths.ts pre-creates it as all-off
 * before any role starts and keeps it read-only in the SDK sandbox, the
 * bubblewrap mask and the file tools, like `enable-terminal.json`. Absent,
 * unreadable, not a regular file owned by this user, or writable by group or
 * others: every setting is off.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

export const OPERATOR_SETTINGS_FILE = 'operator-settings.json';
export const OPERATOR_SETTINGS_DEFAULT = '{ "org": { "allowDrillSigning": false } }\n';

/** The trusted home: from the passwd database, not from the environment. */
export function trustedHome(): string {
  try {
    return userInfo().homedir;
  } catch {
    return '';
  }
}

/** `org.allowDrillSigning`: true only when the operator wrote exactly `true`. */
export function allowDrillSigning(home: string = trustedHome()): boolean {
  if (!home) return false;
  const path = join(home, '.monomind', OPERATOR_SETTINGS_FILE);
  try {
    const st = lstatSync(path);
    if (!st.isFile() || (st.mode & 0o022) !== 0) return false;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      org?: { allowDrillSigning?: unknown };
    };
    return parsed?.org?.allowDrillSigning === true;
  } catch {
    return false;
  }
}
