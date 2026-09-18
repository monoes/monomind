/**
 * #273: the release-gate org's SETUP and CLEAN UP steps told the coordinator to
 * "empty /home/monoes/mrg-tmp" — the shared TMPDIR every role (and the agent
 * harness's own per-session sandbox bridge) writes into. During the 2.11.1 run,
 * `find /home/monoes/mrg-tmp -mindepth 1 -delete` deleted the live socket of the
 * session running it and permanently broke that role's Bash tool for the rest of
 * the ~4 hour run.
 *
 * The shipped config must never instruct a role to empty a directory that holds
 * its own scratch or any live run's.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const configPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'config',
  'orgs',
  'release-gate.json',
);

const raw = readFileSync(configPath, 'utf8');

/** The shared scratch root the org mandates as TMPDIR for every command. */
const SHARED_TMPDIR = '/home/monoes/mrg-tmp';

describe('release-gate org config', () => {
  const def = JSON.parse(raw) as {
    name: string;
    roles: { id: string; responsibilities?: string[] }[];
  };

  it('is valid JSON with the expected roles', () => {
    expect(def.name).toBe('release-gate');
    expect(def.roles.map((r) => r.id)).toContain('release-captain');
  });

  const instructions = (): string[] =>
    def.roles.flatMap((r) => (r.responsibilities ?? []).map((line) => `${r.id}: ${line}`));

  /** A blanket-wipe phrasing only counts as an instruction when it is not
   *  being forbidden — the config names these commands in order to ban them. */
  const forbiddenNearby = (line: string, at: number): boolean =>
    /\b(?:no|not|never)\b[^.]{0,40}$/i.test(line.slice(Math.max(0, at - 60), at));

  it('never tells a role to empty or recursively delete the shared TMPDIR root', () => {
    const wipePatterns = [
      new RegExp(`empty\\s+(?:it\\s+)?${SHARED_TMPDIR}(?![\\w/-])`, 'gi'),
      new RegExp(`rm\\s+-rf\\s+${SHARED_TMPDIR}(?:/\\*)?(?![\\w/-])`, 'g'),
      new RegExp(`${SHARED_TMPDIR}\\s+-mindepth\\s+1\\s+-delete`, 'g'),
    ];
    const offenders = instructions().filter((line) =>
      wipePatterns.some((re) => {
        re.lastIndex = 0;
        for (let m = re.exec(line); m; m = re.exec(line)) {
          if (!forbiddenNearby(line, m.index)) return true;
        }
        return false;
      }),
    );
    expect(offenders).toEqual([]);
  });

  it('spells out the narrow, run-scoped pruning rule instead', () => {
    const all = instructions().join('\n');
    expect(all).toMatch(/issue #273/);
    // The rule has to say both halves: never the root, only this org's own
    // run-scoped subdirectories.
    expect(all).toMatch(/never .{0,120}\/home\/monoes\/mrg-tmp/i);
    expect(all).toMatch(/short-sha/i);
  });
});
