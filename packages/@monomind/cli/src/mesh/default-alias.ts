import { basename } from 'node:path';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** Highest `-N` suffix tried before giving up and reporting the alias as taken. */
const MAX_SUFFIX = 99;

/** `<project>-<YYYYMMDD>-<HHMMSS>` in local time: the name a session gets when it picks none. */
export function defaultAlias(projectPath: string, started: Date): string {
  const stamp =
    `${started.getFullYear()}${pad(started.getMonth() + 1)}${pad(started.getDate())}` +
    `-${pad(started.getHours())}${pad(started.getMinutes())}${pad(started.getSeconds())}`;
  // 64 is the alias limit; 15 for the stamp, 1 for the dash and 3 kept for a `-NN` suffix.
  const name =
    basename(projectPath)
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .slice(0, 45) || 'project';
  return `${name}-${stamp}`;
}

/** Joins as `base`, then `base-2`, `base-3`… while the hub reports the alias as taken. */
export async function joinWithFreeAlias(
  base: string,
  join: (alias: string) => Promise<string>,
): Promise<string> {
  for (let n = 1; ; n++) {
    try {
      return await join(n === 1 ? base : `${base}-${n}`);
    } catch (e) {
      const taken = e instanceof Error && e.message === 'alias_taken';
      if (!taken || n >= MAX_SUFFIX) throw e;
    }
  }
}
