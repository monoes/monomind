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

/** Who is asking: the org and role of the calling process, and the clock. */
export interface DrillGrantContext {
  org?: string;
  role?: string;
  now?: number;
}

/** #720: the longest window one scoped grant may cover. */
export const DRILL_GRANT_MAX_MS = 24 * 3_600_000;

const names = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x && x !== '*')
    ? (v as string[])
    : undefined;

/** A scoped grant (#720): `{ orgs, roles, issuedAt, expiresAt }`. Valid only
 *  for a named org and role, inside a window of at most 24 hours. */
function grantAllows(g: unknown, ctx: DrillGrantContext): boolean {
  if (!g || typeof g !== 'object') return false;
  const { orgs, roles, issuedAt, expiresAt } = g as Record<string, unknown>;
  const o = names(orgs);
  const r = names(roles);
  const from = typeof issuedAt === 'string' ? Date.parse(issuedAt) : Number.NaN;
  const to = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN;
  if (!o || !r || Number.isNaN(from) || Number.isNaN(to) || to - from > DRILL_GRANT_MAX_MS)
    return false;
  const now = ctx.now ?? Date.now();
  if (now < from || now >= to) return false;
  return !!ctx.org && !!ctx.role && o.includes(ctx.org) && r.includes(ctx.role);
}

/** `org.allowDrillSigning`: true when the operator wrote exactly `true`, or a
 *  scoped, time-limited grant (#720) that matches `ctx`. */
export function allowDrillSigning(
  home: string = trustedHome(),
  ctx: DrillGrantContext = {},
): boolean {
  if (!home) return false;
  const path = join(home, '.monomind', OPERATOR_SETTINGS_FILE);
  try {
    const st = lstatSync(path);
    if (!st.isFile() || (st.mode & 0o022) !== 0) return false;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      org?: { allowDrillSigning?: unknown };
    };
    const v = parsed?.org?.allowDrillSigning;
    return v === true || grantAllows(v, ctx);
  } catch {
    return false;
  }
}
